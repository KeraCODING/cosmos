export const SHADOW_GLSL = /* glsl */ `
uniform vec3 uSunPos; uniform float uSunRadius; uniform vec4 uOccluders[2]; uniform int uOccluderCount;
float discCoverage(float a, float b, float c) {
  if (c >= a + b) return 0.0;
  float full = min(1.0, (b * b) / (a * a));
  if (c <= abs(a - b)) return full;
  return full * (1.0 - smoothstep(abs(a - b), a + b, c));
}
float eclipseLight(vec3 p) {
  vec3 toSun = uSunPos - p; float ds = length(toSun); vec3 s = toSun / ds; float a = asin(clamp(uSunRadius / ds, 0.0, 1.0)); float light = 1.0;
  for (int i = 0; i < uOccluderCount; i++) {
    vec3 o = uOccluders[i].xyz - p; float d = length(o);
    if (d <= uOccluders[i].w || d > ds || dot(o, s) <= 0.0) continue;
    light *= 1.0 - discCoverage(a, asin(clamp(uOccluders[i].w / d, 0.0, 1.0)), acos(clamp(dot(o / d, s), -1.0, 1.0)));
  }
  return light;
}`;

export const RING_SHADE_GLSL = /* glsl */ `
uniform vec3 uRingN, uRingC; uniform float uRingR;
float ringShade(vec3 p){ vec3 s=normalize(uSunPos-p); float den=dot(s,uRingN); if(abs(den)<1e-4) return 1.0; float t=dot(uRingC-p,uRingN)/den; if(t<=0.0) return 1.0; float r=length(p+s*t-uRingC)/uRingR;
  float o=(smoothstep(1.2387,1.26,r)*(1.-smoothstep(1.51,1.5264,r)))*.12+(smoothstep(1.5264,1.54,r)*(1.-smoothstep(1.94,1.9509,r)))*.86+(smoothstep(2.0269,2.035,r)*(1.-smoothstep(2.26,2.2695,r)))*.56; return 1.0-o*.85; }`;

const LOGV = `#include <common>\n#include <logdepthbuf_pars_vertex>`, LOGF = `#include <common>\n#include <logdepthbuf_pars_fragment>`;

export const SKY_VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; }`;
export const SKY_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform float uGain; varying vec3 vDir; const float E = 0.40909280;
void main(){ vec3 d = normalize(vDir); float X=d.x, Yc=-d.z, Zc=d.y; float Y = Yc*cos(E) - Zc*sin(E); float Z = Yc*sin(E) + Zc*cos(E);
  vec2 uv = vec2(fract(atan(Y, X) / 6.28318530718), asin(clamp(Z,-1.,1.)) / 3.14159265359 + 0.5);
  gl_FragColor = vec4(pow(texture2D(uMap, uv).rgb, vec3(2.2)) * uGain, 1.0); }`;

export const STAR_VERT = /* glsl */ `
attribute float aSize, aPhase, aSpike; attribute vec3 aColor; uniform float uScale, uTime, uTwinkle; varying vec3 vColor; varying float vSpike;
void main(){ float tw = sin(uTime * (1.3 + aPhase * 0.31) + aPhase) * sin(uTime * (2.9 + aPhase * 0.17) + aPhase * 2.1); vColor = aColor * (1.0 + uTwinkle * 0.42 * tw); vSpike = aSpike * uTwinkle * (0.72 + 0.28 * tw);
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position = p.xyww; gl_PointSize = aSize * uScale * (1.0 + uTwinkle * (0.12 * tw + aSpike * 3.4)); }`;
export const STAR_FRAG = /* glsl */ `varying vec3 vColor; varying float vSpike;
void main(){ vec2 c = gl_PointCoord - 0.5; float k = 1.0 + vSpike * 3.4, a = exp(-dot(c,c) * 18.0 * k * k); a += vSpike * 0.5 * (exp(-abs(c.x) * 70.0) * exp(-c.y * c.y * 26.0) + exp(-abs(c.y) * 70.0) * exp(-c.x * c.x * 26.0)); gl_FragColor = vec4(vColor * a, 1.0); }`;

export const SUN_VERT = /* glsl */ `${LOGV}\nvarying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vP = position; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv;\n#include <logdepthbuf_vertex>\n}`;
/** Limb darkening is physical; the moving granulation and spots are illustrative, not solar observations. */
export const SUN_FRAG = /* glsl */ `${LOGF}
varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float uTime, uDetail;
float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main(){
#include <logdepthbuf_fragment>
  vec3 p = normalize(vP); float t = uTime * .09;
  float g = n3(p*46.+t)*.5 + n3(p*104.-t*1.6)*.3 + n3(p*210.+t*2.3)*.2, wide = n3(p*3.6+vec3(t*.35,0.,t*.2))*.6 + n3(p*9.-vec3(0.,t*.5,0.))*.4;
  float cells = mix(1., (.74 + .52*g) * (.86 + .28*wide), uDetail);
  float band = smoothstep(.56,.34,abs(p.y)) * smoothstep(.05,.14,abs(p.y));
  float group = smoothstep(.56,.66, n3(p*3.1+vec3(9.,t*.05,2.))), fine = n3(p*25.+vec3(3.,0.,t*.05));
  float spot = smoothstep(.62,.72, fine) * group * band * uDetail, pen = smoothstep(.5,.62, fine) * group * band * uDetail, flare = smoothstep(.6,.72, n3(p*11.+vec3(t*.18,7.,0.))) * group * band * uDetail;
  float mu = clamp(dot(normalize(vN), normalize(vV)),0.,1.); float l = 1.0 - 0.56*(1.0-mu) - 0.2*(1.0-mu*mu);
  vec3 hot = mix(vec3(1.0,0.91,0.80), mix(vec3(1.0,0.34,0.08), vec3(1.0,0.66,0.26), smoothstep(.15,.8,mu)), uDetail);
  gl_FragColor = vec4(hot*l*mix(9.0,3.4,uDetail)*cells*(1.-.42*pen)*(1.-.6*spot)*(1.+.6*flare), 1.0); }`;

export const GLARE_VERT = /* glsl */ `varying vec2 vUv; uniform float uSize; void main(){ vUv = uv; vec4 c = modelViewMatrix * vec4(0.,0.,0.,1.); c.xy += position.xy * uSize * -c.z; gl_Position = projectionMatrix * c; gl_Position.z = gl_Position.w * 0.999999; }`;
export const GLARE_FRAG = /* glsl */ `varying vec2 vUv; uniform float uGain; void main(){ float r = length(vUv-0.5)*2.0; float g = pow(max(0.,1.-r),7.0); gl_FragColor = vec4(vec3(1.0,0.86,0.70)*g*uGain,1.0); }`;

export const ATMO_VERT = /* glsl */ `${LOGV}\nuniform float uTop; varying vec3 vLocal; varying vec3 vWorld; void main(){ vLocal = position * uTop; vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;\n#include <logdepthbuf_vertex>\n}`;
/** Single-scattering Rayleigh + Mie, integrated in units of the planet radius. */
export const atmoFrag = (steps: number) => /* glsl */ `${LOGF}
${SHADOW_GLSL}
varying vec3 vLocal; varying vec3 vWorld; uniform vec3 uCam, uSunDir, uBetaR; uniform float uBetaM, uHR, uHM, uTop, uGain; const int N = ${steps};
vec2 hit(vec3 o, vec3 d, float r){ float b=dot(o,d), c=dot(o,o)-r*r, h=b*b-c; if(h<0.) return vec2(1.,-1.); h=sqrt(h); return vec2(-b-h,-b+h); }
void main(){
#include <logdepthbuf_fragment>
  vec3 d = normalize(vLocal-uCam); vec2 s = hit(uCam,d,uTop); if(s.x>s.y||s.y<0.) discard; float t0=max(s.x,0.), t1=s.y; vec2 g=hit(uCam,d,1.0); if(g.x<=g.y&&g.x>0.) t1=min(t1,g.x);
  float ds=(t1-t0)/float(N), oR=0., oM=0.; vec3 R=vec3(0.), M=vec3(0.);
  for(int i=0;i<N;i++){ vec3 p=uCam+d*(t0+ds*(float(i)+.5)); float h=max(length(p)-1.,0.), dR=exp(-h/uHR)*ds, dM=exp(-h/uHM)*ds; oR+=dR; oM+=dM;
    vec2 ls=hit(p,uSunDir,uTop); vec2 lg=hit(p,uSunDir,1.0); if(lg.x<=lg.y&&lg.x>0.) continue; float lt=ls.y/3., lR=0., lM=0.;
    for(int j=0;j<3;j++){ float lh=max(length(p+uSunDir*lt*(float(j)+.5))-1.,0.); lR+=exp(-lh/uHR)*lt; lM+=exp(-lh/uHM)*lt; }
    vec3 tau=uBetaR*(oR+lR)+uBetaM*1.1*(oM+lM); vec3 a=exp(-tau); R+=a*dR; M+=a*dM; }
  float mu=dot(d,uSunDir), gg=.76, pR=.0597*(1.+mu*mu), pM=.1194*((1.-gg*gg)*(1.+mu*mu))/((2.+gg*gg)*pow(1.+gg*gg-2.*gg*mu,1.5));
  vec3 c=(R*uBetaR*pR+M*uBetaM*pM)*uGain*eclipseLight(vWorld); gl_FragColor=vec4(c,1.0); }`;

export const RING_VERT = /* glsl */ `${LOGV}\nvarying vec3 vLocal; varying vec3 vWorld; void main(){ vLocal=position; vec4 w=modelMatrix*vec4(position,1.0); vWorld=w.xyz; gl_Position=projectionMatrix*viewMatrix*w;\n#include <logdepthbuf_vertex>\n}`;
/** Ring band limits are real (km / Saturn radius); fine structure inside the bands is illustrative. */
export const RING_FRAG = /* glsl */ `${LOGF}\n${SHADOW_GLSL}
varying vec3 vLocal; varying vec3 vWorld;
float n(float x){ return fract(sin(floor(x)*91.7)*43758.5)*(1.-fract(x))+fract(sin((floor(x)+1.)*91.7)*43758.5)*fract(x); }
void main(){
#include <logdepthbuf_fragment>
  float r=length(vLocal.xz); float C=smoothstep(1.2387,1.26,r)*(1.-smoothstep(1.51,1.5264,r))*.12, B=smoothstep(1.5264,1.54,r)*(1.-smoothstep(1.94,1.9509,r))*.86, A=smoothstep(2.0269,2.035,r)*(1.-smoothstep(2.26,2.2695,r))*.56;
  float o=C+B+A; if(o<.004) discard; float f=n(r*90.)*.5+n(r*310.)*.3+n(r*23.)*.2; o*=.72+.5*f; vec3 c=mix(vec3(.62,.55,.45),vec3(.86,.80,.70),f); float l=eclipseLight(vWorld);
  gl_FragColor=vec4(c*.82*l,clamp(o,0.,1.)); }`;
