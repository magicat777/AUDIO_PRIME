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
  // Apply height from magnitude
  float heightScale = 4.0;
  float height = aMagnitude * heightScale;

  // Beat-reactive height boost for front rows
  float beatBoost = uBeatStrength * 0.5 * (1.0 - aTimeIndex);
  height += beatBoost;

  vec3 pos = vec3(aPosition.x, height, aPosition.z + uTerrainOffset);

  gl_Position = uMVP * vec4(pos, 1.0);

  vFreqIndex = aFreqIndex;
  vTimeIndex = aTimeIndex;
  vMagnitude = aMagnitude;
  vDepth = clamp((aPosition.z + uTerrainOffset + 25.0) / 50.0, 0.0, 1.0);
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

  // Intensity based on magnitude
  float intensity = 0.5 + 0.5 * vMagnitude;

  // Brightness varies with depth (closer = brighter)
  float depthBrightness = 0.6 + 0.4 * (1.0 - vDepth);

  vec3 color = baseColor * intensity * depthBrightness;

  // Apply glow for peaks
  color = applyGlow(color, vMagnitude, 0.5);

  // Apply fog at distance
  color = applyFog(color, vDepth * 1.5);

  // Brightness boost
  color *= 1.4;

  // Alpha for depth fade
  float alpha = 1.0 - vDepth * 0.4;

  fragColor = vec4(color, alpha);
}
`;

export class TerrainRenderer extends Base3DRenderer {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vertexBuffer: WebGLBuffer;
  private indexBuffer: WebGLBuffer;

  // Configuration
  private gridWidth = 256;      // Frequency resolution
  private gridDepth = 100;      // History depth
  private terrainWidth = 20.0;  // World units wide
  private terrainDepth = 50.0;  // World units deep

  // Animation
  private terrainOffset = 0;    // Forward motion offset
  private forwardSpeed = 5.0;   // Forward speed

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

    // Update forward motion
    const speedMultiplier = 1.0 + this.beatStrength * 0.3;
    this.terrainOffset += this.forwardSpeed * speedMultiplier * (deltaTime / 1000);

    // Loop terrain offset
    const rowDepth = this.terrainDepth / this.gridDepth;
    if (this.terrainOffset > rowDepth) {
      this.terrainOffset -= rowDepth;
      // Push new spectrum row into history
      this.pushSpectrumRow(spectrum);
    }

    // Update camera - fly-over perspective
    mat4.lookAt(
      this.viewMatrix,
      [0, this.config.cameraHeight, this.config.cameraDistance],  // Camera position
      [0, 0, -this.terrainDepth * 0.4],  // Look at middle of terrain
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

  private pushSpectrumRow(spectrum: Float32Array): void {
    // Advance history index
    this.historyIndex = (this.historyIndex + 1) % this.gridDepth;

    // Resample spectrum to grid width
    const binsToUse = Math.min(spectrum.length, 512);
    const row = this.spectrumHistory[this.historyIndex];

    for (let x = 0; x < this.gridWidth; x++) {
      const spectrumIndex = Math.floor((x / this.gridWidth) * binsToUse);
      row[x] = Math.max(0, Math.min(1, spectrum[spectrumIndex] || 0));
    }
  }

  private updateHeights(): void {
    for (let z = 0; z < this.gridDepth; z++) {
      // Map grid row to history row (ring buffer)
      const historyRow = (this.historyIndex - z + this.gridDepth) % this.gridDepth;
      const row = this.spectrumHistory[historyRow];

      for (let x = 0; x < this.gridWidth; x++) {
        const magnitude = row[x];
        const vertexIdx = (z * this.gridWidth + x) * 6;

        // Update magnitude in vertex data
        this.vertexData[vertexIdx + 5] = magnitude;
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
