/**
 * vec3.ts - 3D Vector Operations for WebGL
 *
 * Optimized for real-time rendering:
 * - All operations write to pre-allocated output arrays
 * - Float32Array for direct WebGL uniform upload
 */

/**
 * Create a new 3D vector
 */
export function create(): Float32Array {
  return new Float32Array(3);
}

/**
 * Create a vector from values
 */
export function fromValues(x: number, y: number, z: number): Float32Array {
  const out = new Float32Array(3);
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/**
 * Set vector values
 */
export function set(
  out: Float32Array,
  x: number,
  y: number,
  z: number
): Float32Array {
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/**
 * Copy vector values
 */
export function copy(out: Float32Array, a: Float32Array): Float32Array {
  out[0] = a[0];
  out[1] = a[1];
  out[2] = a[2];
  return out;
}

/**
 * Add two vectors
 */
export function add(
  out: Float32Array,
  a: Float32Array,
  b: Float32Array
): Float32Array {
  out[0] = a[0] + b[0];
  out[1] = a[1] + b[1];
  out[2] = a[2] + b[2];
  return out;
}

/**
 * Subtract vector b from a
 */
export function subtract(
  out: Float32Array,
  a: Float32Array,
  b: Float32Array
): Float32Array {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

/**
 * Scale a vector by a scalar
 */
export function scale(
  out: Float32Array,
  a: Float32Array,
  s: number
): Float32Array {
  out[0] = a[0] * s;
  out[1] = a[1] * s;
  out[2] = a[2] * s;
  return out;
}

/**
 * Calculate the length of a vector
 */
export function length(a: Float32Array): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}

/**
 * Calculate the squared length of a vector (faster, no sqrt)
 */
export function lengthSquared(a: Float32Array): number {
  return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
}

/**
 * Normalize a vector
 */
export function normalize(out: Float32Array, a: Float32Array): Float32Array {
  const len = a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
  if (len > 0) {
    const invLen = 1 / Math.sqrt(len);
    out[0] = a[0] * invLen;
    out[1] = a[1] * invLen;
    out[2] = a[2] * invLen;
  } else {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }
  return out;
}

/**
 * Calculate the dot product of two vectors
 */
export function dot(a: Float32Array, b: Float32Array): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Calculate the cross product of two vectors
 */
export function cross(
  out: Float32Array,
  a: Float32Array,
  b: Float32Array
): Float32Array {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];

  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;

  return out;
}

/**
 * Linear interpolation between two vectors
 */
export function lerp(
  out: Float32Array,
  a: Float32Array,
  b: Float32Array,
  t: number
): Float32Array {
  out[0] = a[0] + t * (b[0] - a[0]);
  out[1] = a[1] + t * (b[1] - a[1]);
  out[2] = a[2] + t * (b[2] - a[2]);
  return out;
}

/**
 * Calculate distance between two points
 */
export function distance(a: Float32Array, b: Float32Array): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Negate a vector
 */
export function negate(out: Float32Array, a: Float32Array): Float32Array {
  out[0] = -a[0];
  out[1] = -a[1];
  out[2] = -a[2];
  return out;
}

/**
 * Transform a vector by a 4x4 matrix
 */
export function transformMat4(
  out: Float32Array,
  a: Float32Array,
  m: Float32Array
): Float32Array {
  const x = a[0], y = a[1], z = a[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1.0;

  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;

  return out;
}
