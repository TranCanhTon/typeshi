// Retro post processing: the scene renders into a low resolution target,
// then one shader pass converts to sRGB, reduces the color depth with
// ordered (Bayer 4x4) dithering on the low res pixel grid, and draws it to
// the screen with nearest neighbour upscaling.
//
// Word labels and HUD (later milestones) are HTML on top, so they stay sharp.

import { HalfFloatType, NearestFilter, Vector2, type Camera, type Scene, WebGLRenderTarget, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const PS1Shader = {
  name: 'PS1Shader',
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new Vector2(480, 270) },
    uDither: { value: 1.0 },
    uLevels: { value: 32.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uDither;
    uniform float uLevels;
    varying vec2 vUv;

    float bayer2( vec2 a ) { a = floor( a ); return fract( dot( a, vec2( 0.5, a.y * 0.75 ) ) ); }
    float bayer4( vec2 a ) { return bayer2( 0.5 * a ) * 0.25 + bayer2( a ); }

    vec3 toSRGB( vec3 c ) {
      c = max( c, 0.0 );
      return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
    }

    void main() {
      vec2 px = floor( vUv * uRes );
      vec3 c = toSRGB( texture2D( tDiffuse, ( px + 0.5 ) / uRes ).rgb );
      float steps = max( uLevels - 1.0, 1.0 );
      float threshold = bayer4( px ) - 0.5;
      c += threshold * uDither / steps;
      c = floor( clamp( c, 0.0, 1.0 ) * steps + 0.5 ) / steps;
      gl_FragColor = vec4( c, 1.0 );
    }
  `,
};

export class RetroPost {
  readonly composer: EffectComposer;
  private pass: ShaderPass;
  width = 480;
  height = 270;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    const rt = new WebGLRenderTarget(480, 270, {
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(1);
    this.composer.addPass(new RenderPass(scene, camera));
    this.pass = new ShaderPass(PS1Shader);
    this.composer.addPass(this.pass);
  }

  /** Internal resolution: width in pixels, height from the screen aspect. */
  setResolution(width: number, aspect: number): void {
    this.width = Math.max(64, Math.round(width));
    this.height = Math.max(36, Math.round(this.width / aspect));
    this.composer.setSize(this.width, this.height);
    this.pass.uniforms.uRes.value.set(this.width, this.height);
  }

  setDither(strength: number, levels: number): void {
    this.pass.uniforms.uDither.value = strength;
    this.pass.uniforms.uLevels.value = levels;
  }

  render(): void {
    this.composer.render();
  }
}
