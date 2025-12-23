/**
 * SpectrumRenderer - WebGL2 instanced rendering for spectrum bars
 * Achieves 60+ FPS with 1024+ bars through GPU instancing
 */

// Vertex shader for instanced bar rendering
const VERTEX_SHADER = `#version 300 es
precision highp float;

// Quad vertices (2 triangles forming a rectangle)
layout(location = 0) in vec2 aPosition;

// Per-instance data
layout(location = 1) in float aBarIndex;
layout(location = 2) in float aMagnitude;

uniform vec2 uResolution;
uniform float uBarCount;
uniform float uBarWidth;
uniform float uBarGap;
uniform float uMaxHeight;
uniform float uBaseY;
uniform float uMarginLeft;
uniform float uMarginRight;
uniform float uMirror; // 0.0 = normal (top half), 1.0 = mirrored (bottom half)

out float vMagnitude;
out float vBarIndex;
out vec2 vUV;
out float vMirror;

void main() {
  // Calculate graph area (respecting margins)
  float graphWidth = uResolution.x - uMarginLeft - uMarginRight;

  // Calculate bar position within the graph area
  float barX = uMarginLeft + (aBarIndex / uBarCount) * graphWidth;
  float barHeight = aMagnitude * uMaxHeight;

  // Transform quad vertex
  vec2 pos = aPosition;
  pos.x = barX + pos.x * uBarWidth;

  if (uMirror < 0.5) {
    // Top half: bars grow upward from baseY (middle line)
    pos.y = uBaseY - pos.y * barHeight;
  } else {
    // Bottom half: bars grow downward from baseY (middle line)
    pos.y = uBaseY + pos.y * barHeight;
  }

  // Convert to clip space (-1 to 1)
  vec2 clipPos = (pos / uResolution) * 2.0 - 1.0;
  clipPos.y = -clipPos.y; // Flip Y

  gl_Position = vec4(clipPos, 0.0, 1.0);

  vMagnitude = aMagnitude;
  vBarIndex = aBarIndex;
  vUV = aPosition;
  vMirror = uMirror;
}
`;

// Fragment shader with gradient coloring
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vMagnitude;
in float vBarIndex;
in vec2 vUV;
in float vMirror;

uniform float uBarCount;
uniform float uTime;

out vec4 fragColor;

// OMEGA-style color palette
vec3 getSpectrumColor(float normalizedIndex) {
  // Purple -> Red -> Orange -> Yellow -> Green -> Cyan -> Blue
  float t = normalizedIndex;

  vec3 color;

  if (t < 0.167) {
    // Sub-bass: Purple to Red
    float s = t / 0.167;
    color = mix(vec3(0.55, 0.27, 0.98), vec3(1.0, 0.2, 0.2), s);
  } else if (t < 0.333) {
    // Bass: Red to Orange/Yellow
    float s = (t - 0.167) / 0.166;
    color = mix(vec3(1.0, 0.2, 0.2), vec3(1.0, 0.8, 0.0), s);
  } else if (t < 0.5) {
    // Low-mid: Yellow to Green
    float s = (t - 0.333) / 0.167;
    color = mix(vec3(1.0, 0.8, 0.0), vec3(0.2, 1.0, 0.2), s);
  } else if (t < 0.667) {
    // Mid: Green to Cyan
    float s = (t - 0.5) / 0.167;
    color = mix(vec3(0.2, 1.0, 0.2), vec3(0.2, 0.9, 0.9), s);
  } else if (t < 0.833) {
    // High-mid: Cyan to Blue
    float s = (t - 0.667) / 0.166;
    color = mix(vec3(0.2, 0.9, 0.9), vec3(0.3, 0.5, 1.0), s);
  } else {
    // High: Blue to Light Blue
    float s = (t - 0.833) / 0.167;
    color = mix(vec3(0.3, 0.5, 1.0), vec3(0.6, 0.8, 1.0), s);
  }

  return color;
}

// Desaturate color by mixing with grayscale
vec3 desaturate(vec3 color, float amount) {
  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(color, vec3(gray), amount);
}

void main() {
  float normalizedIndex = vBarIndex / uBarCount;
  vec3 baseColor = getSpectrumColor(normalizedIndex);

  // Vertical gradient (brighter at top of each bar)
  float verticalGradient = 0.6 + 0.4 * vUV.y;

  // Intensity based on magnitude
  float intensity = 0.5 + 0.5 * vMagnitude;

  vec3 finalColor = baseColor * verticalGradient * intensity;

  // Add slight glow effect for higher magnitudes
  if (vMagnitude > 0.7) {
    finalColor += baseColor * (vMagnitude - 0.7) * 0.3;
  }

  // Apply subtle color variation for bottom half (R channel)
  // Slightly cooler/desaturated to distinguish from top half
  if (vMirror > 0.5) {
    // Shift toward cooler tones and reduce saturation slightly
    finalColor = desaturate(finalColor, 0.15);
    finalColor *= vec3(0.92, 0.95, 1.05); // Slight blue shift
  }

  fragColor = vec4(finalColor, 1.0);
}
`;

export class SpectrumRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private quadBuffer: WebGLBuffer;
  private instanceBuffer: WebGLBuffer;
  private width: number;
  private height: number;
  private barCount: number;
  private instanceData: Float32Array;

  // Peak hold
  private peakHold: Float32Array;
  private peakHoldTime: Float32Array;
  private readonly PEAK_HOLD_MS = 800;
  private readonly PEAK_DECAY_RATE = 0.002; // Per frame
  private lastFrameTime = 0;

  // Margin configuration (must match ScaleOverlay and BassDetailPanel)
  private readonly MARGIN_LEFT = 45;
  private readonly MARGIN_RIGHT = 15;
  private readonly MARGIN_TOP = 20;
  private readonly MARGIN_BOTTOM = 30;

  // Uniform locations
  private uniforms: {
    resolution: WebGLUniformLocation | null;
    barCount: WebGLUniformLocation | null;
    barWidth: WebGLUniformLocation | null;
    barGap: WebGLUniformLocation | null;
    maxHeight: WebGLUniformLocation | null;
    baseY: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    marginLeft: WebGLUniformLocation | null;
    marginRight: WebGLUniformLocation | null;
    mirror: WebGLUniformLocation | null;
  };

  constructor(gl: WebGL2RenderingContext, width: number, height: number, barCount = 512) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.barCount = barCount;
    this.instanceData = new Float32Array(barCount * 2); // index, magnitude per bar

    // Initialize peak hold arrays
    this.peakHold = new Float32Array(barCount);
    this.peakHoldTime = new Float32Array(barCount);

    // Initialize instance data indices
    for (let i = 0; i < barCount; i++) {
      this.instanceData[i * 2] = i;
      this.instanceData[i * 2 + 1] = 0;
    }

    // Compile shaders and create program
    this.program = this.createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
    this.gl.useProgram(this.program);

    // Get uniform locations
    this.uniforms = {
      resolution: gl.getUniformLocation(this.program, 'uResolution'),
      barCount: gl.getUniformLocation(this.program, 'uBarCount'),
      barWidth: gl.getUniformLocation(this.program, 'uBarWidth'),
      barGap: gl.getUniformLocation(this.program, 'uBarGap'),
      maxHeight: gl.getUniformLocation(this.program, 'uMaxHeight'),
      baseY: gl.getUniformLocation(this.program, 'uBaseY'),
      time: gl.getUniformLocation(this.program, 'uTime'),
      marginLeft: gl.getUniformLocation(this.program, 'uMarginLeft'),
      marginRight: gl.getUniformLocation(this.program, 'uMarginRight'),
      mirror: gl.getUniformLocation(this.program, 'uMirror'),
    };

    // Create VAO
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Create quad buffer (unit square)
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    const quadVertices = new Float32Array([
      0, 0, // bottom-left
      1, 0, // bottom-right
      0, 1, // top-left
      1, 1, // top-right
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

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

    // Set initial uniforms
    this.updateUniforms();

    // Configure GL state
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const error = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Program link error: ${error}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader compile error: ${error}`);
    }

    return shader;
  }

  private updateUniforms(): void {
    const gl = this.gl;
    gl.useProgram(this.program);

    // Account for DPR in margin calculations
    const dpr = window.devicePixelRatio || 1;
    const marginLeft = this.MARGIN_LEFT * dpr;
    const marginRight = this.MARGIN_RIGHT * dpr;
    const marginTop = this.MARGIN_TOP * dpr;
    const marginBottom = this.MARGIN_BOTTOM * dpr;

    // Graph dimensions respecting all margins
    const graphWidth = this.width - marginLeft - marginRight;
    const graphHeight = this.height - marginTop - marginBottom;

    const barWidth = (graphWidth / this.barCount) * 1.02;  // Slightly overlap to prevent gaps
    const barGap = 0;  // No gap needed with overlapping bars

    // For mirrored stereo display: bars grow from center line
    // maxHeight is half the graph so each direction (up/down) uses half
    const maxHeight = graphHeight / 2;
    const baseY = marginTop + graphHeight / 2;  // Center line of graph area

    gl.uniform2f(this.uniforms.resolution, this.width, this.height);
    gl.uniform1f(this.uniforms.barCount, this.barCount);
    gl.uniform1f(this.uniforms.barWidth, barWidth);
    gl.uniform1f(this.uniforms.barGap, barGap);
    gl.uniform1f(this.uniforms.maxHeight, maxHeight);
    gl.uniform1f(this.uniforms.baseY, baseY);
    gl.uniform1f(this.uniforms.marginLeft, marginLeft);
    gl.uniform1f(this.uniforms.marginRight, marginRight);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.gl.viewport(0, 0, width, height);
    this.updateUniforms();
  }

  render(spectrumLeft: Float32Array, spectrumRight?: Float32Array): void {
    const gl = this.gl;
    const now = performance.now();
    const deltaTime = now - this.lastFrameTime;
    this.lastFrameTime = now;

    // If no right channel provided, use left for both (backward compatibility)
    const leftSpectrum = spectrumLeft;
    const rightSpectrum = spectrumRight || spectrumLeft;

    // Clear
    gl.clearColor(0.04, 0.04, 0.06, 1.0); // Match --bg-primary
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Update time uniform
    gl.uniform1f(this.uniforms.time, now / 1000);

    // --- Draw LEFT channel (top half) ---
    const barsToRenderLeft = Math.min(this.barCount, leftSpectrum.length);

    for (let i = 0; i < barsToRenderLeft; i++) {
      const magnitude = Math.max(0, Math.min(1, leftSpectrum[i]));

      // Update peak hold for left channel
      const PEAK_THRESHOLD = 0.05;
      if (magnitude > PEAK_THRESHOLD && magnitude > this.peakHold[i]) {
        this.peakHold[i] = magnitude;
        this.peakHoldTime[i] = now;
      } else if (now - this.peakHoldTime[i] > this.PEAK_HOLD_MS) {
        this.peakHold[i] = Math.max(
          0,
          this.peakHold[i] - this.PEAK_DECAY_RATE * (deltaTime / 16.67)
        );
      }

      this.instanceData[i * 2 + 1] = magnitude;
    }

    for (let i = barsToRenderLeft; i < this.barCount; i++) {
      this.instanceData[i * 2 + 1] = 0;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData);

    // Draw top half (left channel - bars grow upward)
    gl.uniform1f(this.uniforms.mirror, 0.0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.barCount);

    // --- Draw RIGHT channel (bottom half) ---
    const barsToRenderRight = Math.min(this.barCount, rightSpectrum.length);

    for (let i = 0; i < barsToRenderRight; i++) {
      const magnitude = Math.max(0, Math.min(1, rightSpectrum[i]));
      this.instanceData[i * 2 + 1] = magnitude;
    }

    for (let i = barsToRenderRight; i < this.barCount; i++) {
      this.instanceData[i * 2 + 1] = 0;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData);

    // Draw bottom half (right channel - bars grow downward)
    gl.uniform1f(this.uniforms.mirror, 1.0);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.barCount);

    gl.bindVertexArray(null);
  }

  /**
   * Get peak hold values for external rendering
   */
  getPeakHold(): Float32Array {
    return this.peakHold;
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.instanceBuffer);
  }
}
