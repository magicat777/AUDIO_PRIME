/**
 * FrequencySphereRenderer - 3D frequency sphere with rays
 *
 * Features:
 * - 256 rays from center arranged on sphere (Fibonacci lattice)
 * - Ray length = spectrum magnitude
 * - OMEGA color palette based on frequency
 * - Glow at ray tips
 * - Beat-reactive sphere pulsation
 *
 * Performance Note:
 * - Significant GPU impact: FPS drops to 40, recovers to 55-57
 * - Combined with spectrum hover (frequency line), drops to 39-42 FPS
 * - Impact persists even when panel not visible on screen
 * - May need optimization or RenderCoordinator visibility check review
 */

import { Base3DRenderer, Renderer3DConfig } from './Base3DRenderer';
import { mat4 } from '../math';
import { SPECTRUM_COLOR_FUNC, GLOW_FUNC } from '../shaders/common3d.glsl';

// Vertex shader for sphere rays
const VERTEX_SHADER = `#version 300 es
precision highp float;

// Per-vertex: position (x, y, z), freqIndex, magnitude, isOuter (0=center, 1=tip)
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aFreqIndex;
layout(location = 2) in float aMagnitude;
layout(location = 3) in float aIsOuter;

uniform mat4 uMVP;
uniform float uTime;
uniform float uBeatPulse;

out float vMagnitude;
out float vFrequencyIndex;
out float vIsOuter;
out vec3 vWorldPos;

void main() {
  // Beat-reactive pulsation for outer vertices
  vec3 pos = aPosition;
  if (aIsOuter > 0.5) {
    // Pulse the outer points with beat
    float pulse = 1.0 + uBeatPulse * 0.15;
    pos *= pulse;
  }

  gl_Position = uMVP * vec4(pos, 1.0);

  vMagnitude = aMagnitude;
  vFrequencyIndex = aFreqIndex;
  vIsOuter = aIsOuter;
  vWorldPos = pos;
}
`;

// Fragment shader with OMEGA colors and glow
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vMagnitude;
in float vFrequencyIndex;
in float vIsOuter;
in vec3 vWorldPos;

uniform float uTime;

out vec4 fragColor;

${SPECTRUM_COLOR_FUNC}
${GLOW_FUNC}

void main() {
  // Get base color from frequency position
  vec3 baseColor = getSpectrumColor(vFrequencyIndex);

  // Intensity based on magnitude
  float intensity = 0.5 + 0.5 * vMagnitude;

  // Outer vertices (tips) are brighter with glow
  float tipBrightness = mix(0.6, 1.4, vIsOuter);

  vec3 color = baseColor * intensity * tipBrightness;

  // Add extra glow at tips for high magnitudes
  if (vIsOuter > 0.5) {
    color = applyGlow(color, vMagnitude, 0.7);
  }

  // Brightness boost
  color *= 1.4;

  fragColor = vec4(color, 1.0);
}
`;

export class FrequencySphereRenderer extends Base3DRenderer {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private vertexBuffer: WebGLBuffer;

  // Configuration
  private numRays = 256;         // Number of rays
  private baseRadius = 0.6;      // Minimum ray length (center sphere)
  private maxRadius = 6.0;       // Maximum ray length

  // Vertex data: x, y, z, freqIndex, magnitude, isOuter (6 floats per vertex)
  // 2 vertices per ray (center + tip)
  private vertexData: Float32Array;

  // Ray directions (precomputed Fibonacci lattice)
  private rayDirections: Float32Array;

  // Uniform locations
  private uniforms: {
    mvp: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    beatPulse: WebGLUniformLocation | null;
  };

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    config?: Partial<Renderer3DConfig>
  ) {
    super(gl, width, height, {
      cameraDistance: 7,
      cameraHeight: 2,
      rotateSpeed: 0.15,
      autoRotate: true,
      fov: 55,
      ...config,
    });

    // Precompute ray directions using Fibonacci lattice
    this.rayDirections = this.computeFibonacciSphere(this.numRays);

    // Create shader program
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this.program);

    // Get uniform locations
    this.uniforms = {
      mvp: gl.getUniformLocation(this.program, 'uMVP'),
      time: gl.getUniformLocation(this.program, 'uTime'),
      beatPulse: gl.getUniformLocation(this.program, 'uBeatPulse'),
    };

    // Create VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Create vertex buffer (2 vertices per ray: center + tip)
    this.vertexData = new Float32Array(this.numRays * 2 * 6);  // 6 floats per vertex

    this.vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData, gl.DYNAMIC_DRAW);

    // Position (x, y, z)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);

    // Frequency index
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 24, 12);

    // Magnitude
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 16);

    // Is outer (0=center, 1=tip)
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 24, 20);

    gl.bindVertexArray(null);
  }

  /**
   * Compute evenly distributed points on a sphere using Fibonacci lattice
   */
  private computeFibonacciSphere(n: number): Float32Array {
    const directions = new Float32Array(n * 3);
    const goldenRatio = (1 + Math.sqrt(5)) / 2;

    for (let i = 0; i < n; i++) {
      // Fibonacci lattice formula
      const theta = 2 * Math.PI * i / goldenRatio;
      const phi = Math.acos(1 - 2 * (i + 0.5) / n);

      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);

      directions[i * 3] = x;
      directions[i * 3 + 1] = y;
      directions[i * 3 + 2] = z;
    }

    return directions;
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

    // Rebuild vertex data based on spectrum
    this.rebuildVertexData(spectrum);

    // Upload vertex data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData);

    // Set uniforms
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.mvp, false, this.mvpMatrix);
    gl.uniform1f(this.uniforms.time, this.time);
    gl.uniform1f(this.uniforms.beatPulse, this.beatStrength);

    // Draw rays as lines
    gl.bindVertexArray(this.vao);
    gl.lineWidth(2.0);  // Note: May not be supported on all hardware
    gl.drawArrays(gl.LINES, 0, this.numRays * 2);
    gl.bindVertexArray(null);
  }

  private rebuildVertexData(spectrum: Float32Array): void {
    const binsToUse = Math.min(spectrum.length, 512);
    let vertexIdx = 0;

    for (let i = 0; i < this.numRays; i++) {
      // Map ray index to spectrum bin
      const spectrumIndex = Math.floor((i / this.numRays) * binsToUse);
      const magnitude = Math.max(0, Math.min(1, spectrum[spectrumIndex] || 0));
      const freqNorm = i / (this.numRays - 1);

      // Get ray direction
      const dx = this.rayDirections[i * 3];
      const dy = this.rayDirections[i * 3 + 1];
      const dz = this.rayDirections[i * 3 + 2];

      // Calculate ray length based on magnitude
      const rayLength = this.baseRadius + magnitude * (this.maxRadius - this.baseRadius);

      // Center vertex (at base radius)
      const centerOffset = vertexIdx * 6;
      this.vertexData[centerOffset] = dx * this.baseRadius;
      this.vertexData[centerOffset + 1] = dy * this.baseRadius;
      this.vertexData[centerOffset + 2] = dz * this.baseRadius;
      this.vertexData[centerOffset + 3] = freqNorm;
      this.vertexData[centerOffset + 4] = magnitude;
      this.vertexData[centerOffset + 5] = 0;  // isOuter = false
      vertexIdx++;

      // Outer vertex (tip)
      const outerOffset = vertexIdx * 6;
      this.vertexData[outerOffset] = dx * rayLength;
      this.vertexData[outerOffset + 1] = dy * rayLength;
      this.vertexData[outerOffset + 2] = dz * rayLength;
      this.vertexData[outerOffset + 3] = freqNorm;
      this.vertexData[outerOffset + 4] = magnitude;
      this.vertexData[outerOffset + 5] = 1;  // isOuter = true
      vertexIdx++;
    }
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.vertexBuffer);
  }
}
