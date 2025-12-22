/**
 * CylindricalBarsRenderer - 3D spectrum bars arranged in a cylinder
 *
 * Features:
 * - 512 bars arranged in a circle
 * - Instanced rendering for performance
 * - Beat-reactive radius pulse
 * - OMEGA color palette
 * - Auto-rotating camera
 */

import { Base3DRenderer, Renderer3DConfig } from './Base3DRenderer';
import { mat4 } from '../math';
import { SPECTRUM_COLOR_FUNC, GLOW_FUNC, FOG_FUNC } from '../shaders/common3d.glsl';

// Vertex shader for cylindrical bar rendering
const VERTEX_SHADER = `#version 300 es
precision highp float;

// Quad vertices (bar geometry)
layout(location = 0) in vec3 aPosition;

// Per-instance data
layout(location = 1) in float aBarIndex;
layout(location = 2) in float aMagnitude;

uniform mat4 uMVP;
uniform float uBarCount;
uniform float uRadius;
uniform float uMaxHeight;
uniform float uBarWidth;
uniform float uTime;
uniform float uBeatStrength;

out float vMagnitude;
out float vBarIndex;
out float vNormalizedIndex;
out vec3 vWorldPos;
out float vHeight;

void main() {
  float normalizedIndex = aBarIndex / uBarCount;

  // Calculate angle for this bar
  float angle = normalizedIndex * 2.0 * 3.14159265;

  // Mirror the color index to match mirrored spectrum data
  // First half (0-0.5): 0 → 1, Second half (0.5-1): 1 → 0
  float colorIndex = normalizedIndex < 0.5
    ? normalizedIndex * 2.0
    : (1.0 - normalizedIndex) * 2.0;

  // Beat-reactive radius
  float beatPulse = uBeatStrength > 0.5 ? (uBeatStrength - 0.5) * 0.2 : 0.0;
  float radius = uRadius + beatPulse;

  // Bar dimensions
  float barHeight = aMagnitude * uMaxHeight;
  float halfWidth = uBarWidth * 0.5;

  // Transform bar position
  // aPosition.x: -0.5 to 0.5 (width)
  // aPosition.y: 0 to 1 (height)
  // aPosition.z: 0 (flat quad facing outward)

  // Position on cylinder circumference
  float cosA = cos(angle);
  float sinA = sin(angle);

  // Local bar position
  vec3 localPos;
  localPos.x = aPosition.x * halfWidth;  // Width along tangent
  localPos.y = aPosition.y * barHeight;   // Height
  localPos.z = 0.0;                        // Depth (flat)

  // Rotate to face outward from cylinder center
  vec3 worldPos;
  worldPos.x = cosA * radius + localPos.x * (-sinA);
  worldPos.y = localPos.y;
  worldPos.z = sinA * radius + localPos.x * cosA;

  gl_Position = uMVP * vec4(worldPos, 1.0);

  vMagnitude = aMagnitude;
  vBarIndex = aBarIndex;
  vNormalizedIndex = colorIndex;  // Use mirrored index for smooth color wrap
  vWorldPos = worldPos;
  vHeight = aPosition.y;
}
`;

// Fragment shader with OMEGA colors
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vMagnitude;
in float vBarIndex;
in float vNormalizedIndex;
in vec3 vWorldPos;
in float vHeight;

uniform float uTime;

out vec4 fragColor;

${SPECTRUM_COLOR_FUNC}
${GLOW_FUNC}
${FOG_FUNC}

void main() {
  // Get base color from spectrum palette
  vec3 baseColor = getSpectrumColor(vNormalizedIndex);

  // Vertical gradient (brighter at top)
  float verticalGradient = 0.5 + 0.5 * vHeight;

  // Intensity based on magnitude
  float intensity = 0.6 + 0.4 * vMagnitude;

  vec3 color = baseColor * verticalGradient * intensity;

  // Add glow for high magnitudes
  color = applyGlow(color, vMagnitude, 0.6);

  // Apply fog based on distance from camera
  float depth = length(vWorldPos) / 10.0;
  color = applyFog(color, depth);

  // Slight pulse based on time
  float pulse = 0.95 + 0.05 * sin(uTime * 2.0 + vNormalizedIndex * 6.28);
  color *= pulse;

  // Brightness boost to compensate for gaps between discrete bars
  color *= 1.4;

  fragColor = vec4(color, 1.0);
}
`;

// Smooth mode vertex shader - continuous ribbon
const SMOOTH_VERTEX_SHADER = `#version 300 es
precision highp float;

// Per-vertex data: position (x,y,z), normalizedIndex, magnitude
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aNormalizedIndex;
layout(location = 2) in float aMagnitude;

uniform mat4 uMVP;
uniform float uTime;
uniform float uBeatStrength;

out float vMagnitude;
out float vNormalizedIndex;
out vec3 vWorldPos;
out float vHeight;

void main() {
  gl_Position = uMVP * vec4(aPosition, 1.0);

  vMagnitude = aMagnitude;
  vNormalizedIndex = aNormalizedIndex;
  vWorldPos = aPosition;
  vHeight = aPosition.y > 0.1 ? 1.0 : 0.0;  // Top vs bottom
}
`;

// Smooth mode fragment shader
const SMOOTH_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vMagnitude;
in float vNormalizedIndex;
in vec3 vWorldPos;
in float vHeight;

uniform float uTime;

out vec4 fragColor;

${SPECTRUM_COLOR_FUNC}
${GLOW_FUNC}
${FOG_FUNC}

void main() {
  vec3 baseColor = getSpectrumColor(vNormalizedIndex);

  // Vertical gradient
  float verticalGradient = 0.5 + 0.5 * vHeight;

  // Intensity based on magnitude
  float intensity = 0.6 + 0.4 * vMagnitude;

  vec3 color = baseColor * verticalGradient * intensity;

  // Add glow for high magnitudes
  color = applyGlow(color, vMagnitude, 0.6);

  // Apply fog
  float depth = length(vWorldPos) / 10.0;
  color = applyFog(color, depth);

  // Pulse
  float pulse = 0.95 + 0.05 * sin(uTime * 2.0 + vNormalizedIndex * 6.28);
  color *= pulse;

  // Brightness boost to match discrete mode
  color *= 1.2;

  fragColor = vec4(color, 1.0);
}
`;

// Grid shader - simple colored lines
const GRID_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aColor;

uniform mat4 uMVP;

out vec3 vColor;

void main() {
  gl_Position = uMVP * vec4(aPosition, 1.0);
  vColor = aColor;
}
`;

const GRID_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vColor;
out vec4 fragColor;

void main() {
  fragColor = vec4(vColor, 0.6);
}
`;

export class CylindricalBarsRenderer extends Base3DRenderer {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quadBuffer: WebGLBuffer;
  private instanceBuffer: WebGLBuffer;
  private barCount: number;
  private instanceData: Float32Array;

  // Smooth mode resources
  private smoothProgram: WebGLProgram | null = null;
  private smoothVao: WebGLVertexArrayObject | null = null;
  private smoothVertexBuffer: WebGLBuffer | null = null;
  private smoothVertexData: Float32Array | null = null;
  private smoothUniforms: {
    mvp: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    beatStrength: WebGLUniformLocation | null;
  } | null = null;

  // Configuration
  private radius = 3.0;
  private maxHeight = 2.0;
  private barWidth = 0.065;  // Discrete mode - visible bars with small gaps
  private smoothMode = false;

  // Grid options
  private showRings = false;      // Horizontal magnitude rings
  private showRadials = false;    // Radial frequency lines
  private showFloor = false;      // Floor grid circle

  // Grid rendering resources
  private gridProgram: WebGLProgram | null = null;
  private gridVao: WebGLVertexArrayObject | null = null;
  private gridBuffer: WebGLBuffer | null = null;
  private gridUniforms: { mvp: WebGLUniformLocation | null } | null = null;

  // Uniform locations
  private uniforms: {
    mvp: WebGLUniformLocation | null;
    barCount: WebGLUniformLocation | null;
    radius: WebGLUniformLocation | null;
    maxHeight: WebGLUniformLocation | null;
    barWidth: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    beatStrength: WebGLUniformLocation | null;
  };

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    config?: Partial<Renderer3DConfig>
  ) {
    super(gl, width, height, {
      cameraDistance: 6,
      cameraHeight: 3,
      rotateSpeed: 0.2,
      ...config,
    });

    this.barCount = 512;
    this.instanceData = new Float32Array(this.barCount * 2);

    // Initialize instance indices
    for (let i = 0; i < this.barCount; i++) {
      this.instanceData[i * 2] = i;
      this.instanceData[i * 2 + 1] = 0;
    }

    // Create shader program
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this.program);

    // Get uniform locations
    this.uniforms = {
      mvp: gl.getUniformLocation(this.program, 'uMVP'),
      barCount: gl.getUniformLocation(this.program, 'uBarCount'),
      radius: gl.getUniformLocation(this.program, 'uRadius'),
      maxHeight: gl.getUniformLocation(this.program, 'uMaxHeight'),
      barWidth: gl.getUniformLocation(this.program, 'uBarWidth'),
      time: gl.getUniformLocation(this.program, 'uTime'),
      beatStrength: gl.getUniformLocation(this.program, 'uBeatStrength'),
    };

    // Create VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Create quad buffer (unit bar shape)
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

    // Bar vertices: 6 vertices for 2 triangles (front face only)
    const quadVertices = new Float32Array([
      // Triangle 1
      -0.5, 0, 0,  // bottom-left
       0.5, 0, 0,  // bottom-right
      -0.5, 1, 0,  // top-left
      // Triangle 2
       0.5, 0, 0,  // bottom-right
       0.5, 1, 0,  // top-right
      -0.5, 1, 0,  // top-left
    ]);

    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // Create instance buffer
    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData, gl.DYNAMIC_DRAW);

    // Bar index (per instance)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(1, 1);

    // Bar magnitude (per instance)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 8, 4);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);

    // Set static uniforms
    gl.uniform1f(this.uniforms.barCount, this.barCount);
    gl.uniform1f(this.uniforms.radius, this.radius);
    gl.uniform1f(this.uniforms.maxHeight, this.maxHeight);
    gl.uniform1f(this.uniforms.barWidth, this.barWidth);

    // Disable back-face culling so we see all bars around the cylinder
    gl.disable(gl.CULL_FACE);

    // Initialize smooth mode resources
    this.initSmoothMode();

    // Initialize grid resources
    this.initGrid();
  }

  private initSmoothMode(): void {
    const gl = this.gl;

    // Create smooth shader program
    this.smoothProgram = this.createProgram(SMOOTH_VERTEX_SHADER, SMOOTH_FRAGMENT_SHADER);
    gl.useProgram(this.smoothProgram);

    this.smoothUniforms = {
      mvp: gl.getUniformLocation(this.smoothProgram, 'uMVP'),
      time: gl.getUniformLocation(this.smoothProgram, 'uTime'),
      beatStrength: gl.getUniformLocation(this.smoothProgram, 'uBeatStrength'),
    };

    // Create VAO for smooth ribbon
    this.smoothVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.smoothVao);

    // Ribbon geometry: triangle strip with 2 vertices per bar (top and bottom)
    // Each vertex has: x, y, z, normalizedIndex, magnitude (5 floats)
    // Total vertices: barCount * 2 + 2 (to close the loop)
    const vertexCount = (this.barCount + 1) * 2;
    this.smoothVertexData = new Float32Array(vertexCount * 5);

    this.smoothVertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.smoothVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.smoothVertexData, gl.DYNAMIC_DRAW);

    // Position (x, y, z)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);

    // Normalized index
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 12);

    // Magnitude
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);

    gl.bindVertexArray(null);
  }

  private initGrid(): void {
    const gl = this.gl;

    // Create grid shader program
    this.gridProgram = this.createProgram(GRID_VERTEX_SHADER, GRID_FRAGMENT_SHADER);
    gl.useProgram(this.gridProgram);
    this.gridUniforms = {
      mvp: gl.getUniformLocation(this.gridProgram, 'uMVP'),
    };

    // Create VAO for grid
    this.gridVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.gridVao);

    // Create buffer - we'll populate it dynamically
    this.gridBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);

    // Position (x, y, z)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);

    // Color (r, g, b)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    gl.bindVertexArray(null);
  }

  // dB levels for rings (magnitude = 10^(dB/20))
  private readonly dbLevels = [
    { db: -12, magnitude: 0.251 },   // 10^(-12/20) ≈ 0.251
    { db: -24, magnitude: 0.063 },   // 10^(-24/20) ≈ 0.063
    { db: -36, magnitude: 0.016 },   // 10^(-36/20) ≈ 0.016
    { db: -48, magnitude: 0.004 },   // 10^(-48/20) ≈ 0.004
  ];

  // Simple 7-segment style character definitions (each segment is a line)
  // Characters are defined in a 3x5 grid, scaled to fit
  private readonly charSegments: Record<string, number[][]> = {
    '0': [[0,0,0,4], [0,4,2,4], [2,4,2,0], [2,0,0,0]],
    '1': [[1,0,1,4]],
    '2': [[0,4,2,4], [2,4,2,2], [2,2,0,2], [0,2,0,0], [0,0,2,0]],
    '3': [[0,4,2,4], [2,4,2,0], [0,0,2,0], [0,2,2,2]],
    '4': [[0,4,0,2], [0,2,2,2], [2,4,2,0]],
    '5': [[2,4,0,4], [0,4,0,2], [0,2,2,2], [2,2,2,0], [2,0,0,0]],
    '6': [[2,4,0,4], [0,4,0,0], [0,0,2,0], [2,0,2,2], [2,2,0,2]],
    '7': [[0,4,2,4], [2,4,2,0]],
    '8': [[0,0,0,4], [0,4,2,4], [2,4,2,0], [2,0,0,0], [0,2,2,2]],
    '9': [[0,2,2,2], [2,2,2,4], [2,4,0,4], [0,4,0,2], [2,2,2,0]],
    '-': [[0,2,2,2]],
    'd': [[2,0,2,3], [2,3,1,4], [1,4,0,3], [0,3,0,1], [0,1,1,0], [1,0,2,0]],
    'B': [[0,0,0,4], [0,4,1.5,4], [1.5,4,2,3.5], [2,3.5,2,2.5], [2,2.5,1.5,2], [0,2,1.5,2], [1.5,2,2,1.5], [2,1.5,2,0.5], [2,0.5,1.5,0], [1.5,0,0,0]],
  };

  // Generate line vertices for a text string at a 3D position
  // Text is rendered in a plane perpendicular to the radial direction
  private addTextVertices(
    vertices: number[],
    text: string,
    baseX: number, baseY: number, baseZ: number,
    scale: number,
    r: number, g: number, b: number,
    angle: number  // Radial angle for orientation
  ): void {
    const charWidth = 2.5 * scale;
    let offsetX = 0;

    // Calculate tangent direction (perpendicular to radial, flipped for readability)
    const tangentX = Math.sin(angle);
    const tangentZ = -Math.cos(angle);

    // Center the text
    const totalWidth = text.length * charWidth;
    const startOffset = -totalWidth / 2;

    // Thickness offsets for bolder lines (smaller offset for tighter grouping)
    const thickness = 0.003;
    const offsets = [
      [0, 0],
      [thickness, 0],
      [-thickness, 0],
    ];

    for (const char of text) {
      const segs = this.charSegments[char];
      if (!segs) {
        offsetX += charWidth;
        continue;
      }

      for (const seg of segs) {
        // seg = [x1, y1, x2, y2] in character space
        const localX1 = seg[0] * scale + offsetX + startOffset;
        const localX2 = seg[2] * scale + offsetX + startOffset;
        const y1 = seg[1] * scale;
        const y2 = seg[3] * scale;

        const x1 = localX1 * tangentX;
        const z1 = localX1 * tangentZ;
        const x2 = localX2 * tangentX;
        const z2 = localX2 * tangentZ;

        // Render multiple offset lines for thickness
        for (const [ox, oy] of offsets) {
          vertices.push(baseX + x1 + ox * tangentX, baseY + y1 + oy, baseZ + z1 + ox * tangentZ, r, g, b);
          vertices.push(baseX + x2 + ox * tangentX, baseY + y2 + oy, baseZ + z2 + ox * tangentZ, r, g, b);
        }
      }

      offsetX += charWidth;
    }
  }

  private buildGridGeometry(): Float32Array {
    const vertices: number[] = [];
    const segments = 64;  // Segments per circle

    // Ring color (cyan)
    const ringR = 0.0, ringG = 0.8, ringB = 0.8;
    // Radial color (yellow)
    const radialR = 0.8, radialG = 0.8, radialB = 0.0;
    // Floor color (dim cyan)
    const floorR = 0.0, floorG = 0.6, floorB = 0.6;
    // Label color (bright white-cyan for better visibility)
    const labelR = 0.7, labelG = 1.0, labelB = 1.0;

    // Horizontal dB rings at -12, -24, -36, -48 dB
    if (this.showRings) {
      // Position for dB labels (at radial index 6, at front of default camera view)
      const labelRadialIndex = 6;
      const labelAngle = (labelRadialIndex / 8) * Math.PI * 2;
      const labelRadius = this.radius + 0.25;  // Further outside the cylinder for visibility
      const labelX = Math.cos(labelAngle) * labelRadius;
      const labelZ = Math.sin(labelAngle) * labelRadius;
      const labelScale = 0.03;  // 25% smaller

      for (const level of this.dbLevels) {
        // Map magnitude to height (using sqrt for better visual spread)
        const y = Math.sqrt(level.magnitude) * this.maxHeight;
        for (let i = 0; i < segments; i++) {
          const angle1 = (i / segments) * Math.PI * 2;
          const angle2 = ((i + 1) / segments) * Math.PI * 2;

          const x1 = Math.cos(angle1) * this.radius;
          const z1 = Math.sin(angle1) * this.radius;
          const x2 = Math.cos(angle2) * this.radius;
          const z2 = Math.sin(angle2) * this.radius;

          // Line segment
          vertices.push(x1, y, z1, ringR, ringG, ringB);
          vertices.push(x2, y, z2, ringR, ringG, ringB);
        }

        // Add dB label at this ring level (just the number, "dB" implied)
        const labelText = `${level.db}`;
        this.addTextVertices(
          vertices,
          labelText,
          labelX, y + 0.08, labelZ,  // Aligned with ring level
          labelScale,
          labelR, labelG, labelB,
          labelAngle
        );
      }
    }

    // Radial frequency lines (8 lines marking frequency positions)
    if (this.showRadials) {
      const radialCount = 8;
      for (let i = 0; i < radialCount; i++) {
        const angle = (i / radialCount) * Math.PI * 2;
        const x = Math.cos(angle) * this.radius;
        const z = Math.sin(angle) * this.radius;

        // Vertical line from floor to max height
        vertices.push(x, -0.05, z, radialR, radialG, radialB);
        vertices.push(x, this.maxHeight, z, radialR, radialG, radialB);
      }
    }

    // Floor grid circle (slightly below y=0 to avoid z-fighting)
    if (this.showFloor) {
      const floorY = -0.05;
      for (let i = 0; i < segments; i++) {
        const angle1 = (i / segments) * Math.PI * 2;
        const angle2 = ((i + 1) / segments) * Math.PI * 2;

        const x1 = Math.cos(angle1) * this.radius;
        const z1 = Math.sin(angle1) * this.radius;
        const x2 = Math.cos(angle2) * this.radius;
        const z2 = Math.sin(angle2) * this.radius;

        // Floor circle line segment
        vertices.push(x1, floorY, z1, floorR, floorG, floorB);
        vertices.push(x2, floorY, z2, floorR, floorG, floorB);
      }
    }

    return new Float32Array(vertices);
  }

  // Get dB level positions for external label rendering
  getDbLevelPositions(): Array<{ db: number; y: number }> {
    return this.dbLevels.map(level => ({
      db: level.db,
      y: Math.sqrt(level.magnitude) * this.maxHeight
    }));
  }

  private renderGrid(): void {
    const gl = this.gl;

    if (!this.gridProgram || !this.gridVao || !this.gridBuffer || !this.gridUniforms) {
      return;
    }

    if (!this.showRings && !this.showRadials && !this.showFloor) {
      return;
    }

    // Build grid geometry based on current settings
    const gridData = this.buildGridGeometry();
    if (gridData.length === 0) return;

    // Upload geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.DYNAMIC_DRAW);

    // Enable blending for semi-transparent grid
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Draw grid
    gl.useProgram(this.gridProgram);
    gl.uniformMatrix4fv(this.gridUniforms.mvp, false, this.mvpMatrix);

    gl.bindVertexArray(this.gridVao);
    gl.drawArrays(gl.LINES, 0, gridData.length / 6);  // 6 floats per vertex
    gl.bindVertexArray(null);

    gl.disable(gl.BLEND);
  }

  render(spectrum: Float32Array, deltaTime: number): void {
    const gl = this.gl;

    // Update time
    this.time += deltaTime / 1000;

    // Update camera
    this.updateCamera(deltaTime);

    // Reset model matrix to identity
    mat4.identity(this.modelMatrix);

    // Compute MVP
    this.computeMVP();

    // Clear framebuffer
    this.clear();

    // Compute mirrored magnitudes for all bars
    const halfBars = this.barCount / 2;
    const spectrumBins = Math.min(halfBars, spectrum.length);
    const magnitudes = new Float32Array(this.barCount);

    for (let i = 0; i < halfBars; i++) {
      const spectrumIndex = Math.floor((i / halfBars) * spectrumBins);
      const magnitude = Math.max(0, Math.min(1, spectrum[spectrumIndex] || 0));
      magnitudes[i] = magnitude;
      magnitudes[this.barCount - 1 - i] = magnitude;
    }

    if (this.smoothMode) {
      this.renderSmooth(magnitudes);
    } else {
      this.renderDiscrete(magnitudes);
    }

    // Render grid overlay
    this.renderGrid();
  }

  private renderDiscrete(magnitudes: Float32Array): void {
    const gl = this.gl;

    // Update instance data
    for (let i = 0; i < this.barCount; i++) {
      this.instanceData[i * 2 + 1] = magnitudes[i];
    }

    // Update instance buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData);

    // Set uniforms
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.mvp, false, this.mvpMatrix);
    gl.uniform1f(this.uniforms.time, this.time);
    gl.uniform1f(this.uniforms.beatStrength, this.beatStrength);

    // Draw instanced bars
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.barCount);
    gl.bindVertexArray(null);
  }

  private renderSmooth(magnitudes: Float32Array): void {
    const gl = this.gl;

    if (!this.smoothVertexData || !this.smoothVao || !this.smoothProgram || !this.smoothUniforms) {
      return;
    }

    // Beat-reactive radius
    const beatPulse = this.beatStrength > 0.5 ? (this.beatStrength - 0.5) * 0.2 : 0.0;
    const radius = this.radius + beatPulse;

    // Build ribbon geometry - triangle strip around the cylinder
    // Each segment has 2 vertices: bottom (y=0) and top (y=height)
    let vertexIndex = 0;

    for (let i = 0; i <= this.barCount; i++) {
      const barIndex = i % this.barCount;
      const normalizedIndex = barIndex / this.barCount;

      // Angle for this position
      const angle = normalizedIndex * 2.0 * Math.PI;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);

      // Position on cylinder
      const x = cosA * radius;
      const z = sinA * radius;

      // Get magnitude and height
      const magnitude = magnitudes[barIndex];
      const height = magnitude * this.maxHeight;

      // Mirrored color index (same as discrete mode)
      const colorIndex = normalizedIndex < 0.5
        ? normalizedIndex * 2.0
        : (1.0 - normalizedIndex) * 2.0;

      // Bottom vertex
      const bottomOffset = vertexIndex * 5;
      this.smoothVertexData[bottomOffset] = x;
      this.smoothVertexData[bottomOffset + 1] = 0;
      this.smoothVertexData[bottomOffset + 2] = z;
      this.smoothVertexData[bottomOffset + 3] = colorIndex;
      this.smoothVertexData[bottomOffset + 4] = magnitude;
      vertexIndex++;

      // Top vertex
      const topOffset = vertexIndex * 5;
      this.smoothVertexData[topOffset] = x;
      this.smoothVertexData[topOffset + 1] = height;
      this.smoothVertexData[topOffset + 2] = z;
      this.smoothVertexData[topOffset + 3] = colorIndex;
      this.smoothVertexData[topOffset + 4] = magnitude;
      vertexIndex++;
    }

    // Update buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.smoothVertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.smoothVertexData);

    // Set uniforms
    gl.useProgram(this.smoothProgram);
    gl.uniformMatrix4fv(this.smoothUniforms.mvp, false, this.mvpMatrix);
    gl.uniform1f(this.smoothUniforms.time, this.time);
    gl.uniform1f(this.smoothUniforms.beatStrength, this.beatStrength);

    // Draw triangle strip
    gl.bindVertexArray(this.smoothVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertexIndex);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.instanceBuffer);

    // Clean up smooth mode resources
    if (this.smoothProgram) gl.deleteProgram(this.smoothProgram);
    if (this.smoothVao) gl.deleteVertexArray(this.smoothVao);
    if (this.smoothVertexBuffer) gl.deleteBuffer(this.smoothVertexBuffer);

    // Clean up grid resources
    if (this.gridProgram) gl.deleteProgram(this.gridProgram);
    if (this.gridVao) gl.deleteVertexArray(this.gridVao);
    if (this.gridBuffer) gl.deleteBuffer(this.gridBuffer);
  }

  // Smooth mode toggle - switches between discrete bars and continuous ribbon
  setSmoothMode(enabled: boolean): void {
    this.smoothMode = enabled;
  }

  getSmoothMode(): boolean {
    return this.smoothMode;
  }

  // Grid toggles
  setShowRings(enabled: boolean): void {
    this.showRings = enabled;
  }

  getShowRings(): boolean {
    return this.showRings;
  }

  setShowRadials(enabled: boolean): void {
    this.showRadials = enabled;
  }

  getShowRadials(): boolean {
    return this.showRadials;
  }

  setShowFloor(enabled: boolean): void {
    this.showFloor = enabled;
  }

  getShowFloor(): boolean {
    return this.showFloor;
  }
}
