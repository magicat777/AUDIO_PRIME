/**
 * TerrainRenderer - 3D terrain landscape from spectrum history
 *
 * Features:
 * - 256 x 100 vertex grid mesh
 * - Height from spectrum history (ring buffer)
 * - Wireframe rendering with OMEGA colors
 * - Fly-over camera perspective with forward motion
 * - Beat-reactive terrain pulse
 */

import { Base3DRenderer, Renderer3DConfig } from './Base3DRenderer';
import { mat4 } from '../math';
import { SPECTRUM_COLOR_FUNC, FOG_FUNC, GLOW_FUNC } from '../shaders/common3d.glsl';

// Vertex shader for terrain mesh
const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aFreqIndex;    // X position (frequency)
layout(location = 2) in float aTimeIndex;    // Z position (time/history)
layout(location = 3) in float aMagnitude;    // Height value

uniform mat4 uMVP;
uniform float uTime;
uniform float uBeatStrength;
uniform float uTerrainOffset;  // Forward motion offset

out float vFreqIndex;
out float vTimeIndex;
out float vMagnitude;
out float vDepth;
out vec3 vWorldPos;

void main() {
  // Apply height from magnitude with enhanced scaling
  float heightScale = 6.0;
  // Apply exponential curve for more dramatic peaks
  float enhancedMag = pow(aMagnitude, 0.7) * 1.2;
  float height = enhancedMag * heightScale;

  // Beat effect DISABLED - was causing jitter
  // float beatBoost = uBeatStrength * 1.0 * (1.0 - aTimeIndex);
  // height += beatBoost;

  // Terrain scrolls away from camera (into negative Z / distance)
  vec3 pos = vec3(aPosition.x, height, aPosition.z - uTerrainOffset);

  gl_Position = uMVP * vec4(pos, 1.0);

  vFreqIndex = aFreqIndex;
  vTimeIndex = aTimeIndex;
  vMagnitude = aMagnitude;
  // Depth: 0 = front (newest, brightest), 1 = back (oldest, faded)
  // aPosition.z goes from 0 (front) to -terrainDepth (back)
  // So we negate and normalize: depth = -z / terrainDepth
  vDepth = clamp(-aPosition.z / 40.0, 0.0, 1.0);
  vWorldPos = pos;
}
`;

// Fragment shader with terrain coloring
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vFreqIndex;
in float vTimeIndex;
in float vMagnitude;
in float vDepth;
in vec3 vWorldPos;

uniform float uTime;

out vec4 fragColor;

${SPECTRUM_COLOR_FUNC}
${FOG_FUNC}
${GLOW_FUNC}

void main() {
  // Get color from frequency position
  vec3 baseColor = getSpectrumColor(vFreqIndex);

  // Enhanced intensity based on magnitude - more dramatic for peaks
  float intensity = 0.4 + 0.8 * pow(vMagnitude, 0.6);

  // Brightness varies with depth (closer = much brighter)
  float depthBrightness = 0.4 + 0.6 * (1.0 - vDepth);

  vec3 color = baseColor * intensity * depthBrightness;

  // Strong glow for peaks
  color = applyGlow(color, vMagnitude, 0.3);

  // Boost saturation for high magnitudes
  float satBoost = 1.0 + vMagnitude * 0.5;
  vec3 gray = vec3(dot(color, vec3(0.299, 0.587, 0.114)));
  color = mix(gray, color, satBoost);

  // Apply fog at distance (gentler)
  color = applyFog(color, vDepth * 1.2);

  // Overall brightness boost
  color *= 1.6;

  // Alpha for depth fade (less aggressive)
  float alpha = 1.0 - vDepth * 0.3;

  fragColor = vec4(color, alpha);
}
`;

export class TerrainRenderer extends Base3DRenderer {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vertexBuffer: WebGLBuffer;
  private indexBuffer: WebGLBuffer;

  // Configuration
  private gridWidth = 128;      // Frequency resolution (reduced for denser lines)
  private gridDepth = 150;      // History depth (more rows for smoother history)
  private terrainWidth = 20.0;  // World units wide
  private terrainDepth = 40.0;  // World units deep

  // Animation
  private terrainOffset = 0;    // Forward motion offset
  private forwardSpeed = 3.0;   // Forward speed (slower for smoother scrolling)
  private accumulator = 0;      // Time accumulator for smooth updates

  // Spectrum history ring buffer
  private spectrumHistory: Float32Array[];
  private historyIndex = 0;

  // Vertex data: x, y, z, freqIndex, timeIndex, magnitude (6 floats per vertex)
  private vertexData: Float32Array;
  private indexData: Uint32Array;
  private vertexCount: number;
  private indexCount: number;

  // Uniform locations
  private uniforms: {
    mvp: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    beatStrength: WebGLUniformLocation | null;
    terrainOffset: WebGLUniformLocation | null;
  };

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    config?: Partial<Renderer3DConfig>
  ) {
    super(gl, width, height, {
      cameraDistance: 15,
      cameraHeight: 8,
      rotateSpeed: 0,
      autoRotate: false,
      fov: 60,
      ...config,
    });

    // Initialize spectrum history
    this.spectrumHistory = [];
    for (let i = 0; i < this.gridDepth; i++) {
      this.spectrumHistory.push(new Float32Array(this.gridWidth));
    }

    // Create shader program
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this.program);

    // Get uniform locations
    this.uniforms = {
      mvp: gl.getUniformLocation(this.program, 'uMVP'),
      time: gl.getUniformLocation(this.program, 'uTime'),
      beatStrength: gl.getUniformLocation(this.program, 'uBeatStrength'),
      terrainOffset: gl.getUniformLocation(this.program, 'uTerrainOffset'),
    };

    // Build geometry
    this.vertexCount = this.gridWidth * this.gridDepth;
    // Lines: horizontal + vertical
    this.indexCount = (this.gridWidth - 1) * this.gridDepth * 2 +
                      this.gridWidth * (this.gridDepth - 1) * 2;

    this.vertexData = new Float32Array(this.vertexCount * 6);
    this.indexData = new Uint32Array(this.indexCount);

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

    // Frequency index (normalized 0-1)
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 24, 12);

    // Time index (normalized 0-1)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 16);

    // Magnitude
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 24, 20);

    // Create and fill index buffer
    this.indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indexData, gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    // Disable culling for wireframe
    gl.disable(gl.CULL_FACE);
  }

  private buildGeometry(): void {
    let vertexIdx = 0;
    let indexIdx = 0;

    // Create vertices
    for (let z = 0; z < this.gridDepth; z++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const worldX = (x / (this.gridWidth - 1) - 0.5) * this.terrainWidth;
        const worldZ = -(z / (this.gridDepth - 1)) * this.terrainDepth;

        const vIdx = vertexIdx * 6;
        this.vertexData[vIdx] = worldX;
        this.vertexData[vIdx + 1] = 0; // Height (updated per frame)
        this.vertexData[vIdx + 2] = worldZ;
        this.vertexData[vIdx + 3] = x / (this.gridWidth - 1); // Freq index
        this.vertexData[vIdx + 4] = z / (this.gridDepth - 1); // Time index
        this.vertexData[vIdx + 5] = 0; // Magnitude

        vertexIdx++;
      }
    }

    // Create line indices
    // Horizontal lines (along X)
    for (let z = 0; z < this.gridDepth; z++) {
      for (let x = 0; x < this.gridWidth - 1; x++) {
        const current = z * this.gridWidth + x;
        const next = current + 1;
        this.indexData[indexIdx++] = current;
        this.indexData[indexIdx++] = next;
      }
    }

    // Vertical lines (along Z)
    for (let x = 0; x < this.gridWidth; x++) {
      for (let z = 0; z < this.gridDepth - 1; z++) {
        const current = z * this.gridWidth + x;
        const next = (z + 1) * this.gridWidth + x;
        this.indexData[indexIdx++] = current;
        this.indexData[indexIdx++] = next;
      }
    }
  }

  render(spectrum: Float32Array, deltaTime: number): void {
    const gl = this.gl;

    // Update time
    this.time += deltaTime / 1000;

    // Always update the front row with current spectrum for smooth real-time response
    this.updateFrontRow(spectrum);

    // Update forward motion (constant speed, no beat reactivity for smoothness)
    this.terrainOffset += this.forwardSpeed * (deltaTime / 1000);

    // Accumulate time for row scrolling
    this.accumulator += deltaTime;
    const rowInterval = 33.33; // Push new row ~30 times per second for smooth history

    // Loop terrain offset and push history rows at regular intervals
    const rowDepth = this.terrainDepth / this.gridDepth;
    if (this.terrainOffset > rowDepth) {
      this.terrainOffset -= rowDepth;
    }

    // Push spectrum rows at regular intervals for smooth history
    if (this.accumulator >= rowInterval) {
      this.accumulator -= rowInterval;
      this.pushSpectrumRow(spectrum);
    }

    // Update camera - fly-over perspective
    // Camera positioned above and in front, looking down the terrain into the distance
    mat4.lookAt(
      this.viewMatrix,
      [0, this.config.cameraHeight + 4, 8],  // Camera above and in front
      [0, 1, -this.terrainDepth * 0.3],       // Look toward middle-back of terrain
      [0, 1, 0]   // Up vector
    );

    // No model transform needed
    mat4.identity(this.modelMatrix);

    // Compute MVP
    this.computeMVP();

    // Clear framebuffer
    this.clear();

    // Update vertex heights from history
    this.updateHeights();

    // Upload vertex data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData);

    // Set uniforms
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.mvp, false, this.mvpMatrix);
    gl.uniform1f(this.uniforms.time, this.time);
    gl.uniform1f(this.uniforms.beatStrength, this.beatStrength);
    gl.uniform1f(this.uniforms.terrainOffset, this.terrainOffset);

    // Draw wireframe
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.LINES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  // Smoothed height buffer for rendering (separate from raw history)
  private smoothedHeights: Float32Array | null = null;

  // Update front row with current spectrum for real-time response
  private updateFrontRow(spectrum: Float32Array): void {
    const binsToUse = Math.min(spectrum.length, 512);
    const row = this.spectrumHistory[this.historyIndex];

    for (let x = 0; x < this.gridWidth; x++) {
      // Sample wider range of bins and average for smoother frequency response
      const centerIdx = (x / this.gridWidth) * binsToUse;
      let sum = 0;
      let count = 0;
      for (let i = -4; i <= 4; i++) {
        const idx = Math.floor(centerIdx + i);
        if (idx >= 0 && idx < binsToUse) {
          // Gaussian-like weighting
          const weight = 1.0 - Math.abs(i) * 0.15;
          sum += (spectrum[idx] || 0) * weight;
          count += weight;
        }
      }
      const newVal = Math.max(0, Math.min(1, count > 0 ? sum / count : 0));
      // Strong temporal smoothing
      row[x] = row[x] * 0.6 + newVal * 0.4;
    }
  }

  private pushSpectrumRow(spectrum: Float32Array): void {
    // Get previous row for temporal smoothing
    const prevRowIdx = this.historyIndex;
    const prevRow = this.spectrumHistory[prevRowIdx];

    // Advance history index
    this.historyIndex = (this.historyIndex + 1) % this.gridDepth;

    // Resample spectrum to grid width with smoothing
    const binsToUse = Math.min(spectrum.length, 512);
    const row = this.spectrumHistory[this.historyIndex];

    for (let x = 0; x < this.gridWidth; x++) {
      // Sample wider range of bins
      const centerIdx = (x / this.gridWidth) * binsToUse;
      let sum = 0;
      let count = 0;
      for (let i = -4; i <= 4; i++) {
        const idx = Math.floor(centerIdx + i);
        if (idx >= 0 && idx < binsToUse) {
          const weight = 1.0 - Math.abs(i) * 0.15;
          sum += (spectrum[idx] || 0) * weight;
          count += weight;
        }
      }
      const rawVal = Math.max(0, Math.min(1, count > 0 ? sum / count : 0));
      // Strong blend with previous row
      row[x] = prevRow[x] * 0.5 + rawVal * 0.5;
    }
  }

  private updateHeights(): void {
    // Initialize smoothed buffer if needed
    if (!this.smoothedHeights || this.smoothedHeights.length !== this.gridWidth * this.gridDepth) {
      this.smoothedHeights = new Float32Array(this.gridWidth * this.gridDepth);
    }

    // First pass: copy raw values
    for (let z = 0; z < this.gridDepth; z++) {
      const historyRow = (this.historyIndex - z + this.gridDepth) % this.gridDepth;
      const row = this.spectrumHistory[historyRow];
      for (let x = 0; x < this.gridWidth; x++) {
        this.smoothedHeights[z * this.gridWidth + x] = row[x];
      }
    }

    // Second pass: horizontal blur (5-tap)
    for (let z = 0; z < this.gridDepth; z++) {
      for (let x = 2; x < this.gridWidth - 2; x++) {
        const idx = z * this.gridWidth + x;
        const smoothed =
          this.smoothedHeights[idx - 2] * 0.1 +
          this.smoothedHeights[idx - 1] * 0.2 +
          this.smoothedHeights[idx] * 0.4 +
          this.smoothedHeights[idx + 1] * 0.2 +
          this.smoothedHeights[idx + 2] * 0.1;
        this.smoothedHeights[idx] = smoothed;
      }
    }

    // Third pass: vertical blur (3-tap) for temporal smoothness
    for (let z = 1; z < this.gridDepth - 1; z++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const idx = z * this.gridWidth + x;
        const prevIdx = (z - 1) * this.gridWidth + x;
        const nextIdx = (z + 1) * this.gridWidth + x;
        const smoothed =
          this.smoothedHeights[prevIdx] * 0.25 +
          this.smoothedHeights[idx] * 0.5 +
          this.smoothedHeights[nextIdx] * 0.25;
        this.smoothedHeights[idx] = smoothed;
      }
    }

    // Write to vertex buffer
    for (let z = 0; z < this.gridDepth; z++) {
      for (let x = 0; x < this.gridWidth; x++) {
        const vertexIdx = (z * this.gridWidth + x) * 6;
        this.vertexData[vertexIdx + 5] = this.smoothedHeights[z * this.gridWidth + x];
      }
    }
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
  }
}
