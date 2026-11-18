/**
 * Particles — React Bits (https://reactbits.dev), de David Haz.
 * Licença MIT + Commons Clause: pode ser usado dentro do Comandou; não pode ser revendido como
 * componente. Os shaders e o movimento são os originais; o desenho foi passado do `ogl` para
 * WebGL puro (sem dependência nova), sem o "seguir o mouse", com tamanho máximo do ponto, com pausa quando a aba some e um
 * quadro parado para quem pediu menos movimento no sistema.
 */
import { useEffect, useRef } from 'react';

const VERT = `
attribute vec3 position;
attribute vec4 random;
attribute vec3 color;

uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform float uTime;
uniform float uSpread;
uniform float uBaseSize;
uniform float uSizeRandomness;
uniform float uMaxSize;

varying vec4 vRandom;
varying vec3 vColor;

void main() {
  vRandom = random;
  vColor = color;

  vec3 pos = position * uSpread;
  pos.z *= 10.0;

  vec4 mPos = modelMatrix * vec4(pos, 1.0);
  float t = uTime;
  mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
  mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
  mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);

  vec4 mvPos = viewMatrix * mPos;
  gl_PointSize = (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(mvPos.xyz);
  gl_PointSize = min(gl_PointSize, uMaxSize); // Comandou: sem bolhas grandes perto da câmera
  gl_Position = projectionMatrix * mvPos;
}
`;

const FRAG = `
precision highp float;

uniform float uTime;
varying vec4 vRandom;
varying vec3 vColor;

void main() {
  vec2 uv = gl_PointCoord.xy;
  float d = length(uv - vec2(0.5));
  float circle = smoothstep(0.5, 0.4, d) * 0.8;
  gl_FragColor = vec4((vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28)) * circle, circle);
}
`;

type Rgb = [number, number, number];

export interface ParticlesProps {
  /** Cores sorteadas para cada ponto (0–1 por canal). */
  colors: Rgb[];
  count?: number;
  spread?: number;
  speed?: number;
  baseSize?: number;
  sizeRandomness?: number;
  /** Tamanho máximo de um ponto, em px de CSS (Comandou). */
  maxSize?: number;
  className?: string;
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
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

/** Matriz de perspectiva (coluna por coluna, como o WebGL lê). */
function perspective(fovDeg: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan((fovDeg * Math.PI) / 360);
  const nf = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

/** Rotação X, depois Y, depois Z (a ordem do `ogl`). */
function rotation(x: number, y: number, z: number) {
  const [a, b] = [Math.cos(x), Math.sin(x)];
  const [c, d] = [Math.cos(y), Math.sin(y)];
  const [e, f] = [Math.cos(z), Math.sin(z)];
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;
  // prettier-ignore
  return new Float32Array([
    c * e, af + be * d, bf - ae * d, 0,
    -c * f, ae - bf * d, be + af * d, 0,
    d, -b * c, a * c, 0,
    0, 0, 0, 1,
  ]);
}

/** Câmera parada em z = 20, olhando para o meio (como no original). */
const VIEW = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -20, 1]);

export default function Particles({
  colors,
  count = 200,
  spread = 10,
  speed = 0.1,
  baseSize = 100,
  sizeRandomness = 1,
  maxSize = 6,
  className,
}: ParticlesProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  // As cores entram pela chave: a identidade da loja pode chegar depois do primeiro quadro.
  const palette = useRef(colors);
  palette.current = colors;
  const colorKey = colors.flat().join(',');

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      powerPreference: 'low-power',
    });
    if (!canvas || !gl) return; // sem WebGL: fundo liso
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // Pontos sorteados dentro de uma esfera, como no original.
    const cols = palette.current;
    const pos = new Float32Array(count * 3);
    const rnd = new Float32Array(count * 4);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let x: number, y: number, z: number, len: number;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        len = x * x + y * y + z * z;
      } while (len > 1 || len === 0);
      const r = Math.cbrt(Math.random());
      pos.set([x * r, y * r, z * r], i * 3);
      rnd.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      col.set(cols[Math.floor(Math.random() * cols.length)] ?? [1, 1, 1], i * 3);
    }
    const buffers: WebGLBuffer[] = [];
    const attr = (name: string, data: Float32Array, size: number) => {
      const buf = gl.createBuffer();
      if (!buf) return;
      buffers.push(buf);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    attr('position', pos, 3);
    attr('random', rnd, 4);
    attr('color', col, 3);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uModel = u('modelMatrix');
    const uProj = u('projectionMatrix');
    const uTime = u('uTime');
    gl.uniformMatrix4fv(u('viewMatrix'), false, VIEW);
    gl.uniform1f(u('uSpread'), spread);
    gl.uniform1f(u('uSizeRandomness'), sizeRandomness);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    gl.uniform1f(u('uBaseSize'), baseSize * dpr);
    gl.uniform1f(u('uMaxSize'), maxSize * dpr);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const resize = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniformMatrix4fv(uProj, false, perspective(15, w / h, 0.1, 100));
    };

    let elapsed = 0;
    let rotZ = 0;
    let last = 0;
    const draw = () => {
      gl.uniform1f(uTime, elapsed * 0.001);
      gl.uniformMatrix4fv(
        uModel,
        false,
        rotation(Math.sin(elapsed * 0.0002) * 0.1, Math.cos(elapsed * 0.0005) * 0.15, rotZ),
      );
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, count);
    };

    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let raf = 0;
    const loop = (t: number) => {
      const delta = last ? Math.min(t - last, 100) : 0; // volta da aba: sem pulo
      last = t;
      elapsed += delta * speed;
      rotZ += 0.01 * speed;
      draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      resize();
      last = 0;
      if (still?.matches) draw();
      else raf = requestAnimationFrame(loop);
    };
    const ro = new ResizeObserver(() => {
      resize();
      if (still?.matches) draw();
    });
    ro.observe(canvas);
    still?.addEventListener?.('change', start);
    start();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      still?.removeEventListener?.('change', start);
      buffers.forEach((b) => gl.deleteBuffer(b));
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [colorKey, count, spread, speed, baseSize, sizeRandomness, maxSize]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
