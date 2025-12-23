/**
 * Waterfall3DRenderer - 3D spectrum waterfall cascade
 *
 * Features:
 * - Frequency x time vertex grid
 * - Ring buffer for spectrum history (CPU-side)
 * - Height displacement from spectrum magnitude
 * - OMEGA color palette based on magnitude
 * - Fixed perspective camera with slight tilt
 */

import { Base3DRenderer, Renderer3DConfig } from './Base3DRenderer';
import { mat4 } from '../math';
import { SPECTRUM_COLOR_FUNC, FOG_FUNC, GLOW_FUNC } from '../shaders/common3d.glsl';

// Vertex shader for waterfall mesh - position includes height
const VERTEX_SHADER = `#version 300 es
precision highp float;

// Per-vertex: x, y (height), z, freqIndex, magnitude
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aFreqIndex;
layout(location = 2) in float aMagnitude;

uniform mat4 uMVP;
uniform float uTime;

out float vMagnitude;
out float vFrequencyIndex;
out float vTimeIndex;
out vec3 vWorldPos;

void main() {
  gl_Position = uMVP * vec4(aPosition, 1.0);

  vMagnitude = aMagnitude;
  vFrequencyIndex = aFreqIndex;
  vTimeIndex = (aPosition.z + 3.0) / 6.0;  // Normalize z to 0-1
  vWorldPos = aPosition;
}
`;

// Fragment shader with OMEGA colors
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vMagnitude;
in float vFrequencyIndex;
in float vTimeIndex;
in vec3 vWorldPos;

uniform float uTime;

out vec4 fragColor;

${SPECTRUM_COLOR_FUNC}
${GLOW_FUNC}
${FOG_FUNC}

void main() {
  // Get base color from frequency position
  vec3 baseColor = getSpectrumColor(vFrequencyIndex);

  // Intensity based on magnitude
  float intensity = 0.4 + 0.6 * vMagnitude;

  // Fade older rows (further back in time)
  float timeFade = 0.5 + 0.5 * (1.0 - vTimeIndex);

  vec3 color = baseColor * intensity * timeFade;

  // Add glow for high magnitudes
  color = applyGlow(color, vMagnitude, 0.5);

  // Apply fog based on depth
  float depth = (vWorldPos.z + 5.0) / 10.0;  // Normalize depth
  color = applyFog(color, depth * 0.5);

  // Brightness boost
  color *= 1.56;

  fragColor = vec4(color, 1.0);
}
`;

export class Waterfall3DRenderer extends Base3DRenderer {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vertexBuffer: WebGLBuffer;
  private indexBuffer: WebGLBuffer;

  // Configuration
  private freqBins = 128;      // Frequency resolution
  private historyRows = 80;    // Time history depth
  private gridWidth = 8.0;     // World units
  private gridDepth = 6.0;     // World units
  private maxHeight = 2.5;     // Maximum height

  // Vertex data: x, y, z, freqIndex, magnitude (5 floats per vertex)
  private vertexData: Float32Array;
  private vertexCount: number;

  // Ring buffer for spectrum history
  private spectrumHistory: Float32Array[];
  private currentRow = 0;

  // Index counts for drawing
  private mainIndexCount = 0;
  private frontWallIndexCount = 0;
  private backWallIndexCount = 0;
  private leftWallIndexCount = 0;
  private rightWallIndexCount = 0;

  // Wall vertex offsets
  private frontWallVertexOffset: number;
  private backWallVertexOffset: number;
  private leftWallVertexOffset: number;
  private rightWallVertexOffset: number;

  // Uniform locations
  private uniforms: {
    mvp: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
  };

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    config?: Partial<Renderer3DConfig>
  ) {
    super(gl, width, height, {
      cameraDistance: 9,
      cameraHeight: 6,
      rotateSpeed: 0.1,  // Slow rotation
      autoRotate: true,
      fov: 50,
      ...config,
    });

    // Set initial camera angle
    this.cameraAngle = -0.5;

    // Initialize spectrum history ring buffer
    this.spectrumHistory = [];
    for (let i = 0; i < this.historyRows; i++) {
      this.spectrumHistory.push(new Float32Array(this.freqBins));
    }

    // Create shader program
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this.program);

    // Get uniform locations
    this.uniforms = {
      mvp: gl.getUniformLocation(this.program, 'uMVP'),
      time: gl.getUniformLocation(this.program, 'uTime'),
    };

    // Create VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Create vertex buffer
    // Main grid + front/back walls (2 rows each) + left/right walls (2 rows each, historyRows deep)
    const mainVertices = this.freqBins * this.historyRows;
    const frontBackWallVertices = this.freqBins * 2;  // 2 rows per wall (bottom + top)
    const sideWallVertices = this.historyRows * 2;    // 2 rows per wall (bottom + top), along time axis
    this.frontWallVertexOffset = mainVertices;
    this.backWallVertexOffset = mainVertices + frontBackWallVertices;
    this.leftWallVertexOffset = mainVertices + frontBackWallVertices * 2;
    this.rightWallVertexOffset = mainVertices + frontBackWallVertices * 2 + sideWallVertices;
    this.vertexCount = mainVertices + frontBackWallVertices * 2 + sideWallVertices * 2;
    this.vertexData = new Float32Array(this.vertexCount * 5);  // 5 floats per vertex

    this.vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);

    // Position (x, y, z)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);

    // Frequency index
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 12);

    // Magnitude
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);

    // Create index buffer for triangle strips
    this.indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    const indices = this.createAllIndices();
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);

    // Disable back-face culling to see both sides
    gl.disable(gl.CULL_FACE);
  }

  private createAllIndices(): Uint32Array {
    const indices: number[] = [];

    // === Main grid indices ===
    for (let row = 0; row < this.historyRows - 1; row++) {
      for (let col = 0; col < this.freqBins; col++) {
        const topLeft = row * this.freqBins + col;
        const bottomLeft = (row + 1) * this.freqBins + col;
        indices.push(topLeft, bottomLeft);
      }

      // Degenerate triangles to connect strips
      if (row < this.historyRows - 2) {
        const lastIdx = (row + 1) * this.freqBins + (this.freqBins - 1);
        const nextIdx = (row + 1) * this.freqBins;
        indices.push(lastIdx, nextIdx);
      }
    }
    this.mainIndexCount = indices.length;

    // === Front wall indices (newest spectrum, vertical drop to y=0) ===
    // Wall has 2 rows: bottom (y=0) and top (spectrum height)
    // We connect them with a triangle strip
    const frontBase = this.frontWallVertexOffset;
    for (let col = 0; col < this.freqBins; col++) {
      const bottom = frontBase + col;                    // Row 0: y=0
      const top = frontBase + this.freqBins + col;       // Row 1: spectrum height
      indices.push(bottom, top);
    }
    this.frontWallIndexCount = indices.length - this.mainIndexCount;

    // Degenerate to separate from back wall
    indices.push(frontBase + this.freqBins * 2 - 1, this.backWallVertexOffset);

    // === Back wall indices (oldest spectrum, vertical drop to y=0) ===
    const backBase = this.backWallVertexOffset;
    for (let col = 0; col < this.freqBins; col++) {
      const bottom = backBase + col;                     // Row 0: y=0
      const top = backBase + this.freqBins + col;        // Row 1: spectrum height
      indices.push(bottom, top);
    }
    this.backWallIndexCount = indices.length - this.mainIndexCount - this.frontWallIndexCount - 2;

    // Degenerate to separate from left wall
    indices.push(backBase + this.freqBins * 2 - 1, this.leftWallVertexOffset);

    // === Left wall indices (bass side, x = -halfWidth) ===
    const leftBase = this.leftWallVertexOffset;
    for (let row = 0; row < this.historyRows; row++) {
      const bottom = leftBase + row;                      // Row 0: y=0
      const top = leftBase + this.historyRows + row;      // Row 1: spectrum height
      indices.push(bottom, top);
    }
    this.leftWallIndexCount = this.historyRows * 2;

    // Degenerate to separate from right wall
    indices.push(leftBase + this.historyRows * 2 - 1, this.rightWallVertexOffset);

    // === Right wall indices (treble side, x = +halfWidth) ===
    const rightBase = this.rightWallVertexOffset;
    for (let row = 0; row < this.historyRows; row++) {
      const bottom = rightBase + row;                     // Row 0: y=0
      const top = rightBase + this.historyRows + row;     // Row 1: spectrum height
      indices.push(bottom, top);
    }
    this.rightWallIndexCount = this.historyRows * 2;

    return new Uint32Array(indices);
  }

  render(spectrum: Float32Array, deltaTime: number): void {
    const gl = this.gl;

    // Update time
    this.time += deltaTime / 1000;

    // Update camera
    this.updateCamera(deltaTime);

    // Position model centered
    mat4.identity(this.modelMatrix);

    // Compute MVP
    this.computeMVP();

    // Clear framebuffer
    this.clear();

    // Update spectrum history and rebuild vertex data
    this.updateSpectrumHistory(spectrum);
    this.rebuildVertexData();

    // Upload vertex data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData);

    // Set uniforms
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.mvp, false, this.mvpMatrix);
    gl.uniform1f(this.uniforms.time, this.time);

    // Draw all geometry (main grid + all 4 walls)
    gl.bindVertexArray(this.vao);
    const totalIndices = this.mainIndexCount + this.frontWallIndexCount + this.backWallIndexCount +
                         this.leftWallIndexCount + this.rightWallIndexCount + 6;  // +6 for degenerates
    gl.drawElements(gl.TRIANGLE_STRIP, totalIndices, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  private updateSpectrumHistory(spectrum: Float32Array): void {
    // Downsample spectrum to fit our frequency bins
    const row = this.spectrumHistory[this.currentRow];
    const binsToUse = Math.min(spectrum.length, 512);

    for (let i = 0; i < this.freqBins; i++) {
      const spectrumIndex = Math.floor((i / this.freqBins) * binsToUse);
      row[i] = Math.max(0, Math.min(1, spectrum[spectrumIndex] || 0));
    }

    // Advance ring buffer
    this.currentRow = (this.currentRow + 1) % this.historyRows;
  }

  private rebuildVertexData(): void {
    const halfWidth = this.gridWidth / 2;
    const halfDepth = this.gridDepth / 2;

    let vertexIdx = 0;

    // Get newest and oldest history indices for walls
    const newestHistoryIdx = (this.currentRow + this.historyRows - 1) % this.historyRows;
    const oldestHistoryIdx = this.currentRow;
    const newestRow = this.spectrumHistory[newestHistoryIdx];
    const oldestRow = this.spectrumHistory[oldestHistoryIdx];

    // === Main grid vertices ===
    for (let row = 0; row < this.historyRows; row++) {
      // Map row to ring buffer (newest at front z=+3, oldest at back z=-3)
      // currentRow points to NEXT row to write, so most recent is (currentRow - 1)
      const historyIdx = (this.currentRow + this.historyRows - 1 - row) % this.historyRows;
      const rowData = this.spectrumHistory[historyIdx];

      // Z position (depth) - newest at front (+z), oldest at back (-z)
      const z = halfDepth - (row / (this.historyRows - 1)) * this.gridDepth;

      for (let col = 0; col < this.freqBins; col++) {
        const freqNorm = col / (this.freqBins - 1);
        const magnitude = rowData[col];

        // X position (frequency)
        const x = -halfWidth + freqNorm * this.gridWidth;

        // Y position (height from magnitude)
        const y = magnitude * this.maxHeight;

        // Write vertex data
        const offset = vertexIdx * 5;
        this.vertexData[offset] = x;
        this.vertexData[offset + 1] = y;
        this.vertexData[offset + 2] = z;
        this.vertexData[offset + 3] = freqNorm;
        this.vertexData[offset + 4] = magnitude;

        vertexIdx++;
      }
    }

    // === Front wall vertices (newest spectrum at z = +halfDepth) ===
    const frontZ = halfDepth;
    // Row 0: bottom (y=0)
    for (let col = 0; col < this.freqBins; col++) {
      const freqNorm = col / (this.freqBins - 1);
      const x = -halfWidth + freqNorm * this.gridWidth;
      const magnitude = newestRow[col];

      const offset = vertexIdx * 5;
      this.vertexData[offset] = x;
      this.vertexData[offset + 1] = 0;  // Base at y=0
      this.vertexData[offset + 2] = frontZ;
      this.vertexData[offset + 3] = freqNorm;
      this.vertexData[offset + 4] = magnitude * 0.5;  // Dimmer at base
      vertexIdx++;
    }
    // Row 1: top (spectrum height)
    for (let col = 0; col < this.freqBins; col++) {
      const freqNorm = col / (this.freqBins - 1);
      const x = -halfWidth + freqNorm * this.gridWidth;
      const magnitude = newestRow[col];
      const y = magnitude * this.maxHeight;

      const offset = vertexIdx * 5;
      this.vertexData[offset] = x;
      this.vertexData[offset + 1] = y;
      this.vertexData[offset + 2] = frontZ;
      this.vertexData[offset + 3] = freqNorm;
      this.vertexData[offset + 4] = magnitude;
      vertexIdx++;
    }

    // === Back wall vertices (oldest spectrum at z = -halfDepth) ===
    const backZ = -halfDepth;
    // Row 0: bottom (y=0)
    for (let col = 0; col < this.freqBins; col++) {
      const freqNorm = col / (this.freqBins - 1);
      const x = -halfWidth + freqNorm * this.gridWidth;
      const magnitude = oldestRow[col];

      const offset = vertexIdx * 5;
      this.vertexData[offset] = x;
      this.vertexData[offset + 1] = 0;  // Base at y=0
      this.vertexData[offset + 2] = backZ;
      this.vertexData[offset + 3] = freqNorm;
      this.vertexData[offset + 4] = magnitude * 0.3;  // Dimmer at base, more fade for back
      vertexIdx++;
    }
    // Row 1: top (spectrum height)
    for (let col = 0; col < this.freqBins; col++) {
      const freqNorm = col / (this.freqBins - 1);
      const x = -halfWidth + freqNorm * this.gridWidth;
      const magnitude = oldestRow[col];
      const y = magnitude * this.maxHeight;

      const offset = vertexIdx * 5;
      this.vertexData[offset] = x;
      this.vertexData[offset + 1] = y;
      this.vertexData[offset + 2] = backZ;
      this.vertexData[offset + 3] = freqNorm;
      this.vertexData[offset + 4] = magnitude;
      vertexIdx++;
    }

    // === Left wall vertices (bass side at x = -halfWidth) ===
    const leftX = -halfWidth;
    const freqNormLeft = 0;  // Bass = frequency 0
    // Row 0: bottom (y=0) for each time row
    for (let row = 0; row < this.historyRows; row++) {
      const historyIdx = (this.currentRow + this.historyRows - 1 - row) % this.historyRows;
      const magnitude = this.spectrumHistory[historyIdx][0];  // First freq bin (bass)
      const z = halfDepth - (row / (this.historyRows - 1)) * this.gridDepth;
      const timeNorm = row / (this.historyRows - 1);

      const offset = vertexIdx * 5;
      this.vertexData[offset] = leftX;
      this.vertexData[offset + 1] = 0;  // Base at y=0
      this.vertexData[offset + 2] = z;
      this.vertexData[offset + 3] = freqNormLeft;
      this.vertexData[offset + 4] = magnitude * (0.5 - timeNorm * 0.2);  // Gradient fade
      vertexIdx++;
    }
    // Row 1: top (spectrum height) for each time row
    for (let row = 0; row < this.historyRows; row++) {
      const historyIdx = (this.currentRow + this.historyRows - 1 - row) % this.historyRows;
      const magnitude = this.spectrumHistory[historyIdx][0];
      const y = magnitude * this.maxHeight;
      const z = halfDepth - (row / (this.historyRows - 1)) * this.gridDepth;

      const offset = vertexIdx * 5;
      this.vertexData[offset] = leftX;
      this.vertexData[offset + 1] = y;
      this.vertexData[offset + 2] = z;
      this.vertexData[offset + 3] = freqNormLeft;
      this.vertexData[offset + 4] = magnitude;
      vertexIdx++;
    }

    // === Right wall vertices (treble side at x = +halfWidth) ===
    const rightX = halfWidth;
    const freqNormRight = 1;  // Treble = frequency 1
    const lastBin = this.freqBins - 1;
    // Row 0: bottom (y=0) for each time row
    for (let row = 0; row < this.historyRows; row++) {
      const historyIdx = (this.currentRow + this.historyRows - 1 - row) % this.historyRows;
      const magnitude = this.spectrumHistory[historyIdx][lastBin];  // Last freq bin (treble)
      const z = halfDepth - (row / (this.historyRows - 1)) * this.gridDepth;
      const timeNorm = row / (this.historyRows - 1);

      const offset = vertexIdx * 5;
      this.vertexData[offset] = rightX;
      this.vertexData[offset + 1] = 0;  // Base at y=0
      this.vertexData[offset + 2] = z;
      this.vertexData[offset + 3] = freqNormRight;
      this.vertexData[offset + 4] = magnitude * (0.5 - timeNorm * 0.2);  // Gradient fade
      vertexIdx++;
    }
    // Row 1: top (spectrum height) for each time row
    for (let row = 0; row < this.historyRows; row++) {
      const historyIdx = (this.currentRow + this.historyRows - 1 - row) % this.historyRows;
      const magnitude = this.spectrumHistory[historyIdx][lastBin];
      const y = magnitude * this.maxHeight;
      const z = halfDepth - (row / (this.historyRows - 1)) * this.gridDepth;

      const offset = vertexIdx * 5;
      this.vertexData[offset] = rightX;
      this.vertexData[offset + 1] = y;
      this.vertexData[offset + 2] = z;
      this.vertexData[offset + 3] = freqNormRight;
      this.vertexData[offset + 4] = magnitude;
      vertexIdx++;
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
