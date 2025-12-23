/**
 * common3d.glsl.ts - Reusable GLSL snippets for 3D visualizations
 *
 * These shader snippets can be concatenated with visualization-specific code
 * to create complete shaders while maintaining consistency across renderers.
 */

/**
 * Common vertex shader header with MVP uniforms
 */
export const VERTEX_HEADER = `#version 300 es
precision highp float;

uniform mat4 uMVP;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform float uTime;
uniform float uBeatPhase;
uniform float uBeatStrength;
`;

/**
 * Common fragment shader header
 */
export const FRAGMENT_HEADER = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uBeatPhase;
uniform float uBeatStrength;

out vec4 fragColor;
`;

/**
 * OMEGA-style color palette function (matches SpectrumRenderer)
 * Input: normalized frequency index 0-1
 * Output: RGB color
 */
export const SPECTRUM_COLOR_FUNC = `
// OMEGA-style color palette
vec3 getSpectrumColor(float t) {
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
`;

/**
 * Heat map color function (for waterfall/terrain)
 * Input: intensity 0-1
 * Output: RGB color from black through blue/purple/red/yellow to white
 */
export const HEAT_COLOR_FUNC = `
vec3 getHeatColor(float t) {
  t = clamp(t, 0.0, 1.0);

  if (t < 0.2) {
    // Black to Dark Blue
    return mix(vec3(0.0, 0.0, 0.0), vec3(0.0, 0.0, 0.5), t / 0.2);
  } else if (t < 0.4) {
    // Dark Blue to Purple
    return mix(vec3(0.0, 0.0, 0.5), vec3(0.5, 0.0, 0.5), (t - 0.2) / 0.2);
  } else if (t < 0.6) {
    // Purple to Red
    return mix(vec3(0.5, 0.0, 0.5), vec3(1.0, 0.0, 0.0), (t - 0.4) / 0.2);
  } else if (t < 0.8) {
    // Red to Yellow
    return mix(vec3(1.0, 0.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.6) / 0.2);
  } else {
    // Yellow to White
    return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 1.0, 1.0), (t - 0.8) / 0.2);
  }
}
`;

/**
 * Fresnel effect for edge glow
 * Input: normal vector, view direction, power
 * Output: fresnel intensity 0-1
 */
export const FRESNEL_FUNC = `
float fresnel(vec3 normal, vec3 viewDir, float power) {
  return pow(1.0 - max(dot(normal, viewDir), 0.0), power);
}
`;

/**
 * Beat-reactive pulse effect
 * Returns a value that pulses on the beat
 */
export const BEAT_PULSE_FUNC = `
float beatPulse(float phase, float strength, float decay) {
  // Create a pulse that peaks at phase = 0 and decays
  float pulse = exp(-phase * decay) * strength;
  return pulse;
}

// Simpler version with defaults
float beatPulse(float phase, float strength) {
  return beatPulse(phase, strength, 3.0);
}
`;

/**
 * Simple fog for depth perception
 * Input: color, depth (0-1), fog color
 * Output: color with fog applied
 */
export const FOG_FUNC = `
vec3 applyFog(vec3 color, float depth, vec3 fogColor, float density) {
  float fogAmount = 1.0 - exp(-depth * density);
  return mix(color, fogColor, fogAmount);
}

// Default fog (dark background)
vec3 applyFog(vec3 color, float depth) {
  return applyFog(color, depth, vec3(0.04, 0.04, 0.06), 2.0);
}
`;

/**
 * Glow/bloom effect
 * Adds intensity boost for bright areas
 */
export const GLOW_FUNC = `
vec3 applyGlow(vec3 color, float magnitude, float threshold) {
  if (magnitude > threshold) {
    float glowAmount = (magnitude - threshold) / (1.0 - threshold);
    color += color * glowAmount * 0.5;
  }
  return color;
}
`;

/**
 * Noise function for procedural effects
 * Simple hash-based noise
 */
export const NOISE_FUNC = `
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(
      mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
      mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x),
      f.y
    ),
    mix(
      mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
      mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x),
      f.y
    ),
    f.z
  );
}
`;

/**
 * Desaturate helper
 */
export const DESATURATE_FUNC = `
vec3 desaturate(vec3 color, float amount) {
  float gray = dot(color, vec3(0.299, 0.587, 0.114));
  return mix(color, vec3(gray), amount);
}
`;

/**
 * Combine all common functions for convenience
 */
export const ALL_COMMON_FUNCS = `
${SPECTRUM_COLOR_FUNC}
${HEAT_COLOR_FUNC}
${FRESNEL_FUNC}
${BEAT_PULSE_FUNC}
${FOG_FUNC}
${GLOW_FUNC}
${NOISE_FUNC}
${DESATURATE_FUNC}
`;

/**
 * Build a complete vertex shader
 */
export function buildVertexShader(mainCode: string, additionalCode = ''): string {
  return `${VERTEX_HEADER}
${additionalCode}
${mainCode}`;
}

/**
 * Build a complete fragment shader
 */
export function buildFragmentShader(mainCode: string, includeFuncs = true): string {
  return `${FRAGMENT_HEADER}
${includeFuncs ? ALL_COMMON_FUNCS : ''}
${mainCode}`;
}
