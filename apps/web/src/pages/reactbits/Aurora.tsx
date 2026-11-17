/**
 * Aurora — React Bits (https://reactbits.dev), de David Haz.
 * Licença MIT + Commons Clause: pode ser usado dentro do Comandou; não pode ser revendido como
 * componente. O shader é o original; o desenho foi passado do `ogl` para WebGL puro (sem
 * dependência nova), com três cuidados para o login: resolução reduzida, pausa quando a aba some
 * e um quadro parado só, sem animar, para quem pediu menos movimento no sistema. `flat` deixa a
 * cor pura (sem escurecer nas pontas), para fundo claro.
 */
import { useEffect, useRef } from 'react';

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;
uniform float uFlat;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ),
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \\
  int index = 0;                                            \\
  for (int i = 0; i < 2; i++) {                               \\
     ColorStop currentColor = colors[i];                    \\
     bool isInBetween = currentColor.position <= factor;    \\
     index = int(mix(float(index), float(i), float(isInBetween))); \\
  }                                                         \\
  ColorStop currentColor = colors[index];                   \\
  ColorStop nextColor = colors[index + 1];                  \\
  float range = nextColor.position - currentColor.position; \\
  float lerpFactor = (factor - currentColor.position) / range; \\
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \\
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  // uFlat (Comandou): no fundo claro, a cor pura, sem escurecer nas pontas.
  vec3 auroraColor = mix(intensity * rampColor, rampColor, uFlat);

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

type Rgb = [number, number, number];

export interface AuroraProps {
  /** Três cores, da esquerda para a direita (0–1 por canal). */
  colorStops: [Rgb, Rgb, Rgb];
  amplitude?: number;
  blend?: number;
  speed?: number;
  /** Fração da resolução da tela (o brilho é borrado; meia resolução basta e poupa a placa). */
  scale?: number;
  /** Fundo claro: cor pura em vez de escurecer nas pontas. */
  flat?: boolean;
  className?: string;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

export default function Aurora({
  colorStops,
  amplitude = 1.0,
  blend = 0.5,
  speed = 1.0,
  scale = 0.5,
  flat = false,
  className,
}: AuroraProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // As cores mudam sem recriar o WebGL (a identidade da loja chega depois do primeiro quadro).
  const stops = useRef(colorStops);
  stops.current = colorStops;
  const opts = useRef({ amplitude, blend, speed, flat });
  opts.current = { amplitude, blend, speed, flat };
  /** Redesenha o quadro parado (menos movimento) quando as cores chegam. */
  const redraw = useRef<() => void>(() => {});
  const colorKey = colorStops.flat().join(',') + (flat ? 'f' : '');
  useEffect(() => redraw.current(), [colorKey]);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: 'low-power',
    });
    if (!canvas || !gl) return; // sem WebGL: fica só o fundo em CSS
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // Um triângulo que cobre a tela toda.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'position');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uAmp = gl.getUniformLocation(prog, 'uAmplitude');
    const uStops = gl.getUniformLocation(prog, 'uColorStops');
    const uRes = gl.getUniformLocation(prog, 'uResolution');
    const uBlend = gl.getUniformLocation(prog, 'uBlend');
    const uFlat = gl.getUniformLocation(prog, 'uFlat');
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * scale));
      const h = Math.max(1, Math.round(canvas.clientHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uRes, w, h);
    };

    const draw = (t: number) => {
      const o = opts.current;
      gl.uniform1f(uTime, t * 0.001 * o.speed * 0.1);
      gl.uniform1f(uAmp, o.amplitude);
      gl.uniform1f(uBlend, o.blend);
      gl.uniform1f(uFlat, o.flat ? 1 : 0);
      gl.uniform3fv(uStops, stops.current.flat());
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let raf = 0;
    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      resize();
      if (still?.matches)
        draw(12_000); // um quadro bonito, parado
      else raf = requestAnimationFrame(loop);
    };
    const ro = new ResizeObserver(() => {
      resize();
      if (still?.matches) draw(12_000);
    });
    ro.observe(canvas);
    still?.addEventListener?.('change', start);
    redraw.current = () => {
      if (still?.matches) draw(12_000);
    };
    start();

    return () => {
      cancelAnimationFrame(raf);
      redraw.current = () => {};
      ro.disconnect();
      still?.removeEventListener?.('change', start);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [scale]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
