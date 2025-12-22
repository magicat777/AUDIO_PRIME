/**
 * TunnelRenderer - 3D tunnel/portal effect
 *
 * Features:
 * - 40 stacked circular rings receding into screen
 * - Each ring: 64 segments with spectrum-reactive radius
 * - Continuous forward motion with beat-reactive speed
 * - Fog/fade at distance for depth perception
 * - OMEGA color palette based on depth and frequency
 * - Three render modes: Lines, Filled, Filled+Lines
 */

import { Base3DRenderer, Renderer3DConfig } from './Base3DRenderer';
import { mat4 } from '../math';
import { SPECTRUM_COLOR_FUNC, FOG_FUNC, GLOW_FUNC } from '../shaders/common3d.glsl';

// Vertex shader for tunnel rings
const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aRingIndex;    // Which ring (0 = closest)
layout(location = 2) in float aSegmentIndex; // Position around ring (0-1)
layout(location = 3) in float aMagnitude;    // Spectrum magnitude for this segment

uniform mat4 uMVP;
uniform float uTime;
uniform float uBeatStrength;
uniform float uTunnelOffset;  // Forward motion offset

out float vRingIndex;
out float vSegmentIndex;
out float vMagnitude;
out float vDepth;
out vec3 vWorldPos;

void main() {
  vec3 pos = aPosition;

  // Add forward motion offset to Z
  float depth = pos.z + uTunnelOffset;

  // Beat-reactive ring pulse
  float beatPulse = 1.0 + uBeatStrength * 0.15 * (1.0 - aRingIndex / 40.0);
  pos.x *= beatPulse;
  pos.y *= beatPulse;

  // Apply modified position
  vec3 finalPos = vec3(pos.x, pos.y, depth);

  gl_Position = uMVP * vec4(finalPos, 1.0);

  vRingIndex = aRingIndex;
  vSegmentIndex = aSegmentIndex;
  vMagnitude = aMagnitude;
  vDepth = -depth / 50.0; // Normalize depth for fog (0 = close, 1 = far)
  vWorldPos = finalPos;
}
`;

// Fragment shader with spectrum colors and fog
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vRingIndex;
in float vSegmentIndex;
in float vMagnitude;
in float vDepth;
in vec3 vWorldPos;

uniform float uTime;
uniform float uFilledMode;  // 0 = wireframe, 1+ = filled
uniform float uLineBrightness;  // Extra brightness for lines in combined mode

out vec4 fragColor;

${SPECTRUM_COLOR_FUNC}
${FOG_FUNC}
${GLOW_FUNC}

void main() {
  // Mirror segment index for smooth color wrap-around
  // 0→0.5 maps to 0→1, 0.5→1 maps back 1→0
  float mirroredIndex = vSegmentIndex < 0.5
    ? vSegmentIndex * 2.0
    : (1.0 - vSegmentIndex) * 2.0;

  // Get color from mirrored position (creates seamless wrap)
  vec3 baseColor = getSpectrumColor(mirroredIndex);

  // Intensity based on magnitude
  float intensity = 0.4 + 0.6 * vMagnitude;

  // Brightness increases toward center of tunnel
  float centerBrightness = 0.7 + 0.3 * (1.0 - vDepth);

  vec3 color = baseColor * intensity * centerBrightness;

  // Apply glow for high magnitudes
  color = applyGlow(color, vMagnitude, 0.6);

  // Apply fog at distance
  color = applyFog(color, vDepth);

  // Brightness boost - higher for filled mode
  float brightnessBoost = uFilledMode > 0.5 ? 1.5 : 1.3;
  color *= brightnessBoost;

  // Extra brightness for lines in combined mode
  color *= uLineBrightness;

  // Alpha - more opaque for filled mode to show gradient
  float alpha = uFilledMode > 0.5
    ? 0.7 + 0.3 * vMagnitude * (1.0 - vDepth * 0.3)
    : 1.0 - vDepth * 0.5;

  fragColor = vec4(color, alpha);
}
`;

// Render modes
type RenderMode = 'lines' | 'filled' | 'filled+lines';

export class TunnelRenderer extends Base3DRenderer {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vertexBuffer: WebGLBuffer;
  private lineIndexBuffer: WebGLBuffer;
  private fillIndexBuffer: WebGLBuffer;

  // Configuration
  private numRings = 40;        // Number of rings in tunnel
  private segmentsPerRing = 64; // Segments per ring
  private baseRadius = 3.0;     // Base tunnel radius
  private ringSpacing = 1.25;   // Distance between rings

  // Animation
  private tunnelOffset = 0;     // Forward motion offset
  private forwardSpeed = 8.0;   // Base forward speed

  // Render mode: 'lines', 'filled', 'filled+lines'
  private renderMode: RenderMode = 'lines';

  // Vertex data: x, y, z, ringIndex, segmentIndex, magnitude (6 floats per vertex)
  // +1 vertex per ring for proper wrap-around
  private verticesPerRing: number;
  private vertexData: Float32Array;
  private lineIndexData: Uint16Array;
  private fillIndexData: Uint32Array;
  private vertexCount: number;
  private lineIndexCount: number;
  private fillIndexCount: number;

  // Uniform locations
  private uniforms: {
    mvp: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    beatStrength: WebGLUniformLocation | null;
    tunnelOffset: WebGLUniformLocation | null;
    filledMode: WebGLUniformLocation | null;
    lineBrightness: WebGLUniformLocation | null;
  };

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    config?: Partial<Renderer3DConfig>
  ) {
    super(gl, width, height, {
      cameraDistance: 0.1,      // Camera inside tunnel
      cameraHeight: 0,          // Centered
      rotateSpeed: 0,           // No rotation
      autoRotate: false,        // Looking forward
      fov: 90,                  // Wide FOV for tunnel effect
      ...config,
    });

    // +1 for wrap-around vertex
    this.verticesPerRing = this.segmentsPerRing + 1;

    // Create shader program
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this.program);

    // Get uniform locations
    this.uniforms = {
      mvp: gl.getUniformLocation(this.program, 'uMVP'),
      time: gl.getUniformLocation(this.program, 'uTime'),
      beatStrength: gl.getUniformLocation(this.program, 'uBeatStrength'),
      tunnelOffset: gl.getUniformLocation(this.program, 'uTunnelOffset'),
      filledMode: gl.getUniformLocation(this.program, 'uFilledMode'),
      lineBrightness: gl.getUniformLocation(this.program, 'uLineBrightness'),
    };

    // Build geometry
    this.vertexCount = this.numRings * this.verticesPerRing;
    this.lineIndexCount = this.numRings * this.segmentsPerRing * 2; // Lines (no wrap vertex needed)
    // Triangles between rings: (numRings-1) * segmentsPerRing * 2 triangles * 3 vertices
    this.fillIndexCount = (this.numRings - 1) * this.segmentsPerRing * 6;

    this.vertexData = new Float32Array(this.vertexCount * 6);
    this.lineIndexData = new Uint16Array(this.lineIndexCount);
    this.fillIndexData = new Uint32Array(this.fillIndexCount);

    this.buildGeometry();

    // Create VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Create and fill vertex buffer
    this.vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);

    // Position (x, y, z)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);

    // Ring index
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 24, 12);

    // Segment index (normalized 0-1)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 16);

    // Magnitude
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 24, 20);

    // Create line index buffer
    this.lineIndexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexData, gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    // Create fill index buffer (separate, bound when needed)
    this.fillIndexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fillIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.fillIndexData, gl.STATIC_DRAW);

    // Disable culling for tunnel (we see inside)
    gl.disable(gl.CULL_FACE);
  }

  private buildGeometry(): void {
    let lineIdx = 0;
    let fillIdx = 0;

    for (let ring = 0; ring < this.numRings; ring++) {
      const z = -ring * this.ringSpacing; // Rings recede into -Z

      // Create vertices including wrap-around vertex (seg = segmentsPerRing has same position as seg = 0)
      for (let seg = 0; seg <= this.segmentsPerRing; seg++) {
        const actualSeg = seg % this.segmentsPerRing;
        const angle = (actualSeg / this.segmentsPerRing) * Math.PI * 2;
        const x = Math.cos(angle) * this.baseRadius;
        const y = Math.sin(angle) * this.baseRadius;

        const vertexIdx = ring * this.verticesPerRing + seg;
        const vIdx = vertexIdx * 6;
        this.vertexData[vIdx] = x;
        this.vertexData[vIdx + 1] = y;
        this.vertexData[vIdx + 2] = z;
        this.vertexData[vIdx + 3] = ring;
        // Segment index: 0 to 1 (wrap vertex has index 1.0)
        this.vertexData[vIdx + 4] = seg / this.segmentsPerRing;
        this.vertexData[vIdx + 5] = 0; // Magnitude (updated per frame)
      }

      // Line indices - connect consecutive segments (use original vertices, not wrap)
      for (let seg = 0; seg < this.segmentsPerRing; seg++) {
        const currentVertex = ring * this.verticesPerRing + seg;
        const nextVertex = ring * this.verticesPerRing + seg + 1;

        this.lineIndexData[lineIdx++] = currentVertex;
        this.lineIndexData[lineIdx++] = nextVertex;
      }

      // Fill indices - triangles between this ring and next ring
      if (ring < this.numRings - 1) {
        for (let seg = 0; seg < this.segmentsPerRing; seg++) {
          const currentVertex = ring * this.verticesPerRing + seg;
          const nextVertex = ring * this.verticesPerRing + seg + 1;
          const nextRingCurrent = (ring + 1) * this.verticesPerRing + seg;
          const nextRingNext = (ring + 1) * this.verticesPerRing + seg + 1;

          // Triangle 1
          this.fillIndexData[fillIdx++] = currentVertex;
          this.fillIndexData[fillIdx++] = nextRingCurrent;
          this.fillIndexData[fillIdx++] = nextVertex;

          // Triangle 2
          this.fillIndexData[fillIdx++] = nextVertex;
          this.fillIndexData[fillIdx++] = nextRingCurrent;
          this.fillIndexData[fillIdx++] = nextRingNext;
        }
      }
    }
  }

  render(spectrum: Float32Array, deltaTime: number): void {
    const gl = this.gl;

    // Update time
    this.time += deltaTime / 1000;

    // Update forward motion with beat-reactive speed
    const speedMultiplier = 1.0 + this.beatStrength * 0.5;
    this.tunnelOffset += this.forwardSpeed * speedMultiplier * (deltaTime / 1000);

    // Loop tunnel offset
    if (this.tunnelOffset > this.ringSpacing) {
      this.tunnelOffset -= this.ringSpacing;
    }

    // Update camera (looking down -Z)
    mat4.identity(this.viewMatrix);
    mat4.lookAt(
      this.viewMatrix,
      [0, 0, 0],           // Camera at origin
      [0, 0, -1],          // Looking into tunnel
      [0, 1, 0]            // Up vector
    );

    // No model transform needed
    mat4.identity(this.modelMatrix);

    // Compute MVP
    this.computeMVP();

    // Clear framebuffer
    this.clear();

    // Update vertex magnitudes from spectrum
    this.updateMagnitudes(spectrum);

    // Upload vertex data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData);

    // Set uniforms
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.mvp, false, this.mvpMatrix);
    gl.uniform1f(this.uniforms.time, this.time);
    gl.uniform1f(this.uniforms.beatStrength, this.beatStrength);
    gl.uniform1f(this.uniforms.tunnelOffset, this.tunnelOffset);

    gl.bindVertexArray(this.vao);

    if (this.renderMode === 'lines') {
      // Draw rings as lines only
      gl.uniform1f(this.uniforms.filledMode, 0.0);
      gl.uniform1f(this.uniforms.lineBrightness, 1.0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuffer);
      gl.drawElements(gl.LINES, this.lineIndexCount, gl.UNSIGNED_SHORT, 0);
    } else if (this.renderMode === 'filled') {
      // Draw filled triangles only
      gl.uniform1f(this.uniforms.filledMode, 1.0);
      gl.uniform1f(this.uniforms.lineBrightness, 1.0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fillIndexBuffer);
      gl.drawElements(gl.TRIANGLES, this.fillIndexCount, gl.UNSIGNED_INT, 0);
    } else {
      // Draw filled + lines (filled first, then lines on top)
      gl.uniform1f(this.uniforms.filledMode, 1.0);
      gl.uniform1f(this.uniforms.lineBrightness, 1.0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fillIndexBuffer);
      gl.drawElements(gl.TRIANGLES, this.fillIndexCount, gl.UNSIGNED_INT, 0);

      // Draw lines on top - brighter so they stand out
      gl.uniform1f(this.uniforms.filledMode, 0.0);
      gl.uniform1f(this.uniforms.lineBrightness, 2.0);  // Boost brightness for visibility
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lineIndexBuffer);
      gl.drawElements(gl.LINES, this.lineIndexCount, gl.UNSIGNED_SHORT, 0);
    }

    gl.bindVertexArray(null);
  }

  private updateMagnitudes(spectrum: Float32Array): void {
    const binsToUse = Math.min(spectrum.length, 512);

    for (let ring = 0; ring < this.numRings; ring++) {
      for (let seg = 0; seg <= this.segmentsPerRing; seg++) {
        // Map segment to spectrum bin (wrap the last segment)
        const actualSeg = seg % this.segmentsPerRing;
        const spectrumIndex = Math.floor((actualSeg / this.segmentsPerRing) * binsToUse);
        const magnitude = Math.max(0, Math.min(1, spectrum[spectrumIndex] || 0));

        // Update magnitude in vertex data
        const vertexIdx = (ring * this.verticesPerRing + seg) * 6 + 5;
        this.vertexData[vertexIdx] = magnitude;
      }
    }
  }

  /**
   * Set render mode
   */
  setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;
  }

  /**
   * Get current render mode
   */
  getRenderMode(): RenderMode {
    return this.renderMode;
  }

  /**
   * Cycle to next render mode (for toggle button)
   */
  cycleRenderMode(): RenderMode {
    if (this.renderMode === 'lines') {
      this.renderMode = 'filled';
    } else if (this.renderMode === 'filled') {
      this.renderMode = 'filled+lines';
    } else {
      this.renderMode = 'lines';
    }
    return this.renderMode;
  }

  /**
   * Legacy method for compatibility
   */
  setFilledMode(filled: boolean): void {
    this.renderMode = filled ? 'filled' : 'lines';
  }

  /**
   * Legacy method for compatibility
   */
  getFilledMode(): boolean {
    return this.renderMode !== 'lines';
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.lineIndexBuffer);
    gl.deleteBuffer(this.fillIndexBuffer);
  }
}
