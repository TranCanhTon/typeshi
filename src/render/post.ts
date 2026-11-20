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
    /** Blinded by Bisk's spit: 0 = clear, 1 = full. */
    uBlind: { value: 0 },
    uBlindBlur: { value: 5 },
    uBlindDim: { value: 0.55 },
    uBlindTint: { value: 0.18 },
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
    uniform float uBlind;
    uniform float uBlindBlur;
    uniform float uBlindDim;
    uniform float uBlindTint;
    varying vec2 vUv;

    float bayer2( vec2 a ) { a = floor( a ); return fract( dot( a, vec2( 0.5, a.y * 0.75 ) ) ); }
    float bayer4( vec2 a ) { return bayer2( 0.5 * a ) * 0.25 + bayer2( a ); }

    vec3 toSRGB( vec3 c ) {
      c = max( c, 0.0 );
      return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
    }

    void main() {
      vec2 px = floor( vUv * uRes );
      vec3 lin = texture2D( tDiffuse, ( px + 0.5 ) / uRes ).rgb;
      if ( uBlind > 0.001 ) {
        // blinded: a heavy blur (two rings of taps), darker, tinted green
        float r = uBlindBlur * uBlind;
        vec3 sum = lin;
        float n = 1.0;
        for ( int i = 0; i < 12; i++ ) {
          float a = float( i ) * 0.5236; // 30 degrees
          float ring = ( mod( float( i ), 2.0 ) == 0.0 ) ? r : r * 0.5;
          vec2 o = vec2( cos( a ), sin( a ) ) * ring;
          sum += texture2D( tDiffuse, ( px + 0.5 + o ) / uRes ).rgb;
          n += 1.0;
        }
        lin = sum / n;
        lin *= 1.0 - uBlindDim * uBlind;
        lin = mix( lin, lin * vec3( 0.55, 1.25, 0.45 ), uBlindTint * uBlind * 4.0 );
      }
      vec3 c = toSRGB( lin );
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

  /** Blind strength 0..1 and how it looks (from CONFIG.game.bisk.blind). */
  setBlind(level: number, blur: number, dim: number, tint: number): void {
    const u = this.pass.uniforms;
    u.uBlind.value = level;
    u.uBlindBlur.value = blur;
    u.uBlindDim.value = dim;
    u.uBlindTint.value = tint;
  }

  setDither(strength: number, levels: number): void {
    this.pass.uniforms.uDither.value = strength;
    this.pass.uniforms.uLevels.value = levels;
  }

  render(): void {
    this.composer.render();
  }
}
