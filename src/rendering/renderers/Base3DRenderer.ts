/**
 * Base3DRenderer - Abstract base class for all 3D visualizations
 *
 * Provides:
 * - MVP matrix management (Model-View-Projection)
 * - Camera orbit system with configurable speed
 * - Shader compilation utilities
 * - Depth testing configuration
 * - Beat-reactive camera effects
 */

import { mat4, vec3 } from '../math';

export interface Renderer3DConfig {
  fov: number;              // Field of view in degrees (default: 60)
  near: number;             // Near clip plane (default: 0.1)
  far: number;              // Far clip plane (default: 100)
  cameraDistance: number;   // Distance from origin (default: 5)
  cameraHeight: number;     // Height above origin (default: 2)
  autoRotate: boolean;      // Enable auto-rotation (default: true)
  rotateSpeed: number;      // Rotation speed rad/s (default: 0.3)
  beatReactive: boolean;    // Camera reacts to beat (default: true)
  beatIntensity: number;    // Beat effect strength 0-1 (default: 0.3)
}

const DEFAULT_CONFIG: Renderer3DConfig = {
  fov: 60,
  near: 0.1,
  far: 100,
  cameraDistance: 5,
  cameraHeight: 2,
  autoRotate: true,
  rotateSpeed: 0.3,
  beatReactive: true,
  beatIntensity: 0.3,
};

export abstract class Base3DRenderer {
  protected gl: WebGL2RenderingContext;
  protected width: number;
  protected height: number;
  protected config: Renderer3DConfig;

  // Pre-allocated matrices (no per-frame allocations)
  protected projectionMatrix: Float32Array;
  protected viewMatrix: Float32Array;
  protected modelMatrix: Float32Array;
  protected mvpMatrix: Float32Array;
  protected tempMatrix: Float32Array;

  // Pre-allocated vectors
  protected cameraPosition: Float32Array;
  protected cameraTarget: Float32Array;
  protected cameraUp: Float32Array;

  // Animation state
  protected cameraAngle: number = 0;
  protected time: number = 0;
  protected beatPhase: number = 0;
  protected beatStrength: number = 0;

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    config?: Partial<Renderer3DConfig>
  ) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Pre-allocate all matrices
    this.projectionMatrix = mat4.create();
    this.viewMatrix = mat4.create();
    this.modelMatrix = mat4.create();
    this.mvpMatrix = mat4.create();
    this.tempMatrix = mat4.create();

    // Pre-allocate vectors
    this.cameraPosition = vec3.fromValues(0, this.config.cameraHeight, this.config.cameraDistance);
    this.cameraTarget = vec3.fromValues(0, 0, 0);
    this.cameraUp = vec3.fromValues(0, 1, 0);

    // Initialize projection matrix
    this.updateProjection();

    // Configure GL state for 3D
    this.configureGLState();
  }

  /**
   * Configure WebGL state for 3D rendering
   */
  protected configureGLState(): void {
    const gl = this.gl;

    // Enable depth testing for 3D
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // Enable blending for transparency effects
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Enable back-face culling for performance
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  /**
   * Update projection matrix (call on resize)
   */
  protected updateProjection(): void {
    const aspect = this.width / this.height;
    const fovRad = mat4.toRadians(this.config.fov);
    mat4.perspective(
      this.projectionMatrix,
      fovRad,
      aspect,
      this.config.near,
      this.config.far
    );
  }

  /**
   * Update camera based on animation and beat
   */
  protected updateCamera(deltaTime: number): void {
    // Auto-rotate camera
    if (this.config.autoRotate) {
      this.cameraAngle += this.config.rotateSpeed * (deltaTime / 1000);
    }

    // Calculate camera distance with beat effect
    let distance = this.config.cameraDistance;
    if (this.config.beatReactive && this.beatStrength > 0.5) {
      // Push camera back slightly on strong beats
      const beatPush = (this.beatStrength - 0.5) * 2 * this.config.beatIntensity;
      distance += beatPush * 0.5;
    }

    // Calculate camera position on orbit
    const x = Math.sin(this.cameraAngle) * distance;
    const z = Math.cos(this.cameraAngle) * distance;
    const y = this.config.cameraHeight;

    vec3.set(this.cameraPosition, x, y, z);

    // Build view matrix
    mat4.lookAt(
      this.viewMatrix,
      this.cameraPosition,
      this.cameraTarget,
      this.cameraUp
    );
  }

  /**
   * Compute MVP matrix from current matrices
   */
  protected computeMVP(): void {
    // MVP = Projection * View * Model
    mat4.multiply(this.tempMatrix, this.viewMatrix, this.modelMatrix);
    mat4.multiply(this.mvpMatrix, this.projectionMatrix, this.tempMatrix);
  }

  /**
   * Handle resize
   */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.gl.viewport(0, 0, width, height);
    this.updateProjection();
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<Renderer3DConfig>): void {
    this.config = { ...this.config, ...config };
    this.updateProjection();
  }

  /**
   * Set beat info for reactive effects
   */
  setBeatInfo(beatPhase: number, beatStrength: number): void {
    this.beatPhase = beatPhase;
    this.beatStrength = beatStrength;
  }

  /**
   * Compile a shader
   */
  protected compileShader(type: number, source: string): WebGLShader {
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

  /**
   * Create a shader program
   */
  protected createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
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

  /**
   * Clear the framebuffer
   */
  protected clear(): void {
    const gl = this.gl;
    gl.clearColor(0.04, 0.04, 0.06, 1.0); // Match --bg-primary
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /**
   * Abstract render method - subclasses must implement
   * @param spectrum Audio spectrum data (0-1 normalized)
   * @param deltaTime Time since last frame in ms
   */
  abstract render(spectrum: Float32Array, deltaTime: number): void;

  /**
   * Abstract destroy method - subclasses must clean up resources
   */
  abstract destroy(): void;

  /**
   * Get current camera angle (for UI display or syncing)
   */
  getCameraAngle(): number {
    return this.cameraAngle;
  }

  /**
   * Set camera angle (for manual control)
   */
  setCameraAngle(angle: number): void {
    this.cameraAngle = angle;
  }
}
