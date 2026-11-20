// PS1 material patch. Applied to the built-in Three materials via onBeforeCompile:
//  * vertex snapping to the low res pixel grid (the PS1 wobble)
//  * blendable affine texture mapping (the PS1 texture swim)
//  * custom fog: warm brown near the camera fading to black, plus
//    analytic in-scattering so the lamps glow inside the fog.
//
// All patched materials share the same uniform objects, so the debug panel
// changes every material at once.

import { Color, type Material, Vector2, Vector3 } from 'three';
import { LAMP_COUNT } from '../game/layout';

export { LAMP_COUNT };

export const ps1Uniforms = {
  uSnapGrid: { value: new Vector2(240, 135) },
  uSnap: { value: 1.0 },
  uAffine: { value: 0.25 },
  uFogDensity: { value: 0.05 },
  uFogNear: { value: new Color() },
  uFogFar: { value: new Color() },
  uFogColorDist: { value: 26 },
  uLampGlow: { value: 0.003 },
  /** Only view rays passing within about this distance (m) of a lamp pick up its glow. */
  uLampGlowRadius: { value: 1.8 },
  uLampPos: { value: Array.from({ length: LAMP_COUNT }, () => new Vector3()) },
  /** Lamp color * intensity * flicker, updated every frame by the lamps. */
  uLampColor: { value: Array.from({ length: LAMP_COUNT }, () => new Color()) },
};

const VERT_HEAD = /* glsl */ `
uniform vec2 uSnapGrid;
uniform float uSnap;
varying vec3 vDkWorld;
varying float vDkDepth;
#ifdef USE_MAP
varying vec3 vDkAffine;
#endif
`;

const VERT_BODY = /* glsl */ `
#include <project_vertex>
{
  vec4 dkW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    dkW = instanceMatrix * dkW;
  #endif
  dkW = modelMatrix * dkW;
  vDkWorld = dkW.xyz;
  vDkDepth = -mvPosition.z;
  #ifdef USE_MAP
    vDkAffine = vec3( vMapUv * gl_Position.w, gl_Position.w );
  #endif
  if ( uSnap > 0.0 && gl_Position.w > 0.0 ) {
    vec4 p = gl_Position;
    p.xyz /= p.w;
    vec2 grid = uSnapGrid / uSnap;
    p.xy = floor( p.xy * grid + 0.5 ) / grid;
    p.xyz *= p.w;
    gl_Position = p;
  }
}
`;

const FRAG_HEAD = /* glsl */ `
#define DK_LAMPS ${LAMP_COUNT}
uniform float uAffine;
uniform float uFogDensity;
uniform vec3 uFogNear;
uniform vec3 uFogFar;
uniform float uFogColorDist;
uniform float uLampGlow;
uniform float uLampGlowRadius;
uniform vec3 uLampPos[ DK_LAMPS ];
uniform vec3 uLampColor[ DK_LAMPS ];
varying vec3 vDkWorld;
varying float vDkDepth;
#ifdef USE_MAP
varying vec3 vDkAffine;
#endif
`;

const FRAG_MAP = /* glsl */ `
#ifdef USE_MAP
  vec2 dkUv = mix( vMapUv, vDkAffine.xy / vDkAffine.z, uAffine );
  vec4 sampledDiffuseColor = texture2D( map, dkUv );
  diffuseColor *= sampledDiffuseColor;
#endif
`;

const FRAG_FOG = /* glsl */ `
{
  float d = vDkDepth;
  float fogF = 1.0 - exp( -uFogDensity * uFogDensity * d * d );
  vec3 fogCol = mix( uFogNear, uFogFar, smoothstep( 0.0, uFogColorDist, d ) );

  // In-scattering from each lamp along the view ray: integral of 1/r^2
  // from the camera to this fragment, which has a closed form (atan).
  vec3 seg = vDkWorld - cameraPosition;
  float L = length( seg );
  vec3 rd = seg / max( L, 1e-4 );
  vec3 scatter = vec3( 0.0 );
  for ( int i = 0; i < DK_LAMPS; i++ ) {
    vec3 lp = uLampPos[ i ] - cameraPosition;
    float b = dot( lp, rd );
    float h = sqrt( max( dot( lp, lp ) - b * b, 0.09 ) );
    float I = ( atan( ( L - b ) / h ) - atan( -b / h ) ) / h;
    float t = clamp( b, 0.0, L );
    float trans = exp( -uFogDensity * uFogDensity * t * t );
    // Without this, every ray anywhere near a lamp gets a haze, which washes
    // distant zombies into the background. Keep the glow to a halo.
    float halo = exp( -( h * h ) / ( uLampGlowRadius * uLampGlowRadius ) );
    scatter += uLampColor[ i ] * I * trans * halo;
  }
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogF ) + scatter * uLampGlow;
}
`;

/** Patch a built-in material (Basic, Lambert, Phong...) with the PS1 look. */
export function ps1ify<T extends Material>(mat: T): T {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ps1Uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', VERT_HEAD + '\nvoid main() {')
      .replace('#include <project_vertex>', VERT_BODY);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', FRAG_HEAD + '\nvoid main() {')
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <fog_fragment>', FRAG_FOG);
  };
  mat.customProgramCacheKey = () => 'dk-ps1';
  return mat;
}
