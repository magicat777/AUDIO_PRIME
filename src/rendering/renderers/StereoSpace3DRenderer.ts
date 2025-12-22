/**
 * StereoSpace3DRenderer - 3D stereo field point cloud
 *
 * Features:
 * - Point cloud from stereo samples (1024 points)
 * - X: Side (R-L) - stereo width
 * - Y: Time/sample index
 * - Z: Mid (L+R) - mono content
 * - Fade/persistence effect with point history
 * - Reference axes and guide sphere
 * - Color based on stereo position
 */

import { Base3DRenderer, Renderer3DConfig } from './Base3DRenderer';
import { mat4 } from '../math';

// Vertex shader for point cloud
const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aAge;        // 0 = newest, 1 = oldest
layout(location = 2) in float aStereoPos;  // -1 = left, 0 = center, 1 = right

uniform mat4 uMVP;
uniform float uTime;
uniform float uPointSize;

out float vAge;
out float vStereoPos;
out vec3 vWorldPos;

void main() {
  gl_Position = uMVP * vec4(aPosition, 1.0);

  // Point size decreases with age
  gl_PointSize = uPointSize * (1.0 - vAge * 0.5);

  vAge = aAge;
  vStereoPos = aStereoPos;
  vWorldPos = aPosition;
}
`;

// Fragment shader with stereo-based coloring
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vAge;
in float vStereoPos;
in vec3 vWorldPos;

uniform float uTime;

out vec4 fragColor;

void main() {
  // Create circular point
  vec2 coord = gl_PointCoord - vec2(0.5);
  float dist = length(coord);
  if (dist > 0.5) discard;

  // Soft edge
  float alpha = 1.0 - smoothstep(0.3, 0.5, dist);

  // Color based on stereo position
  // Left = cyan, Center = white, Right = magenta
  vec3 leftColor = vec3(0.0, 0.85, 1.0);   // Cyan (slightly deeper)
  vec3 centerColor = vec3(0.9, 0.9, 0.95); // Slightly dimmer white
  vec3 rightColor = vec3(1.0, 0.15, 0.75); // Magenta (slightly deeper)

  vec3 color;
  float stereoIntensity = abs(vStereoPos);

  if (vStereoPos < 0.0) {
    color = mix(centerColor, leftColor, -vStereoPos);
  } else {
    color = mix(centerColor, rightColor, vStereoPos);
  }

  // Boost saturation at extremes - darken center contribution for vivid edges
  float saturationBoost = 1.0 + stereoIntensity * 0.4;

  // Fade with age
  float ageFade = 1.0 - vAge * 0.7;

  // Brightness based on mono content (Z position)
  float monoIntensity = 0.6 + 0.4 * abs(vWorldPos.z) / 2.0;

  color *= ageFade * monoIntensity * saturationBoost;
  alpha *= ageFade;

  fragColor = vec4(color, alpha);
}
`;

// Simple line shader for axes
const LINE_VERTEX_SHADER = `#version 300 es
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

const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vColor;
out vec4 fragColor;

void main() {
  fragColor = vec4(vColor, 0.5);
}
`;

export class StereoSpace3DRenderer extends Base3DRenderer {
  private pointProgram: WebGLProgram;
  private lineProgram: WebGLProgram;
  private pointVao: WebGLVertexArrayObject;
  private lineVao: WebGLVertexArrayObject;
  private pointBuffer: WebGLBuffer;
  private lineBuffer: WebGLBuffer;

  // Configuration
  private numPoints = 480;        // Points per frame (960 samples / 2 channels)
  private historyFrames = 8;      // Number of history frames to show
  private spaceScale = 3.0;       // Scale factor for the space

  // Point data: x, y, z, age, stereoPos (5 floats per point)
  private pointData: Float32Array;
  private totalPoints: number;

  // History ring buffer
  private historyIndex = 0;

  // Uniform locations
  private pointUniforms: {
    mvp: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    pointSize: WebGLUniformLocation | null;
  };
  private lineUniforms: {
    mvp: WebGLUniformLocation | null;
  };

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    config?: Partial<Renderer3DConfig>
  ) {
    super(gl, width, height, {
      cameraDistance: 8,
      cameraHeight: 3,
      rotateSpeed: 0.08,
      autoRotate: true,
      fov: 50,
      ...config,
    });

    // Create point shader program
    this.pointProgram = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    gl.useProgram(this.pointProgram);

    this.pointUniforms = {
      mvp: gl.getUniformLocation(this.pointProgram, 'uMVP'),
      time: gl.getUniformLocation(this.pointProgram, 'uTime'),
      pointSize: gl.getUniformLocation(this.pointProgram, 'uPointSize'),
    };

    // Create line shader program
    this.lineProgram = this.createProgram(LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
    gl.useProgram(this.lineProgram);

    this.lineUniforms = {
      mvp: gl.getUniformLocation(this.lineProgram, 'uMVP'),
    };

    // Create point VAO
    this.totalPoints = this.numPoints * this.historyFrames;
    this.pointData = new Float32Array(this.totalPoints * 5);

    this.pointVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.pointVao);

    this.pointBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.pointData, gl.DYNAMIC_DRAW);

    // Position (x, y, z)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);

    // Age
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 12);

    // Stereo position
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);

    gl.bindVertexArray(null);

    // Create line VAO for axes
    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);

    this.lineBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);

    // Create axis lines data: position (3) + color (3) = 6 floats per vertex
    const axisData = this.createAxisData();
    gl.bufferData(gl.ARRAY_BUFFER, axisData, gl.STATIC_DRAW);

    // Position
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);

    // Color
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    gl.bindVertexArray(null);

    // Enable blending for point transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private createAxisData(): Float32Array {
    const s = this.spaceScale;
    const data: number[] = [];

    // X axis (Side: L-R) - Cyan to Magenta
    // Left side (cyan)
    data.push(-s, 0, 0, 0, 0.9, 1);
    data.push(0, 0, 0, 1, 1, 1);
    // Right side (magenta)
    data.push(0, 0, 0, 1, 1, 1);
    data.push(s, 0, 0, 1, 0.2, 0.8);

    // Y axis (Time) - dim white
    data.push(0, -s, 0, 0.3, 0.3, 0.3);
    data.push(0, s, 0, 0.5, 0.5, 0.5);

    // Z axis (Mid: L+R) - green
    data.push(0, 0, -s, 0.2, 0.8, 0.2);
    data.push(0, 0, s, 0.4, 1, 0.4);

    // Reference circle on XZ plane (stereo field)
    const segments = 32;
    const radius = s * 0.8;
    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      data.push(
        Math.cos(a1) * radius, 0, Math.sin(a1) * radius, 0.3, 0.3, 0.4,
        Math.cos(a2) * radius, 0, Math.sin(a2) * radius, 0.3, 0.3, 0.4
      );
    }

    return new Float32Array(data);
  }

  render(_spectrum: Float32Array, deltaTime: number, stereoSamples?: Float32Array): void {
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

    // Update point data if we have stereo samples
    if (stereoSamples && stereoSamples.length >= this.numPoints * 2) {
      this.updatePointData(stereoSamples);
    }

    // Upload point data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pointData);

    // Draw axes first
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(this.lineUniforms.mvp, false, this.mvpMatrix);
    gl.bindVertexArray(this.lineVao);
    gl.drawArrays(gl.LINES, 0, 6 + 32 * 2);  // 3 axes + circle
    gl.bindVertexArray(null);

    // Draw points
    gl.useProgram(this.pointProgram);
    gl.uniformMatrix4fv(this.pointUniforms.mvp, false, this.mvpMatrix);
    gl.uniform1f(this.pointUniforms.time, this.time);
    gl.uniform1f(this.pointUniforms.pointSize, 5.0);

    gl.bindVertexArray(this.pointVao);
    gl.drawArrays(gl.POINTS, 0, this.totalPoints);
    gl.bindVertexArray(null);
  }

  private updatePointData(stereoSamples: Float32Array): void {
    const s = this.spaceScale;

    // Calculate base offset for current history frame
    const frameOffset = this.historyIndex * this.numPoints * 5;

    // Update ages for all existing points
    for (let frame = 0; frame < this.historyFrames; frame++) {
      const age = ((this.historyIndex - frame + this.historyFrames) % this.historyFrames) / this.historyFrames;
      const baseOffset = frame * this.numPoints * 5;

      for (let i = 0; i < this.numPoints; i++) {
        this.pointData[baseOffset + i * 5 + 3] = age;
      }
    }

    // Write new points to current frame slot
    for (let i = 0; i < this.numPoints; i++) {
      const left = stereoSamples[i * 2];
      const right = stereoSamples[i * 2 + 1];

      // Calculate stereo components
      const mid = (left + right) * 0.5;   // Mono content
      const side = (right - left) * 0.5;  // Stereo width

      // Map to 3D space
      const x = side * s * 3;           // Side on X axis
      const y = (i / this.numPoints - 0.5) * s * 0.5;  // Time/sample on Y
      const z = mid * s * 3;            // Mid on Z axis

      // Stereo position for coloring (-1 to 1)
      const stereoPos = Math.max(-1, Math.min(1, side * 4));

      const offset = frameOffset + i * 5;
      this.pointData[offset] = x;
      this.pointData[offset + 1] = y;
      this.pointData[offset + 2] = z;
      this.pointData[offset + 3] = 0;  // Age = 0 for newest
      this.pointData[offset + 4] = stereoPos;
    }

    // Advance history index
    this.historyIndex = (this.historyIndex + 1) % this.historyFrames;
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.pointProgram);
    gl.deleteProgram(this.lineProgram);
    gl.deleteVertexArray(this.pointVao);
    gl.deleteVertexArray(this.lineVao);
    gl.deleteBuffer(this.pointBuffer);
    gl.deleteBuffer(this.lineBuffer);
  }
}
