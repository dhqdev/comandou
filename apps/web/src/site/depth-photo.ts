/**
 * Foto em 3D do site ("Prato em 3D"): a foto de verdade do prato e um mapa de profundidade dela
 * (tools/site-images/build.py). Um shader desloca cada ponto da foto conforme a profundidade e o
 * ângulo de quem olha: o que está perto anda mais que o fundo, e a foto ganha volume ao mexer o
 * mouse ou arrastar o dedo. Sem mexer, o ângulo passeia sozinho devagar. WebGL puro, sem
 * biblioteca. Para quando sai da tela ou a aba some; com "reduzir movimento", fica parado.
 */

export interface DepthScene {
  photo: string;
  depth: string;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uPhotoA;
uniform sampler2D uDepthA;
uniform sampler2D uPhotoB;
uniform sampler2D uDepthB;
uniform vec2 uLook;
uniform vec2 uCover;
uniform float uMix;
uniform float uAmount;
varying vec2 vUv;

vec4 frame(sampler2D photo, sampler2D depth, vec2 uv) {
  float d = texture2D(depth, uv).r;
  return texture2D(photo, uv + uLook * (d - 0.5) * uAmount);
}

void main() {
  vec2 uv = (vUv - 0.5) * uCover + 0.5;
  vec4 a = frame(uPhotoA, uDepthA, uv);
  vec4 b = uMix > 0.0 ? frame(uPhotoB, uDepthB, uv) : a;
  gl_FragColor = mix(a, b, uMix);
}`;

interface Pair {
  photo: WebGLTexture;
  depth: WebGLTexture;
  aspect: number;
}

const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error(`não carregou ${src}`));
    img.src = src;
  });
}

export function depthSupported(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl');
  } catch {
    return false;
  }
}

export class DepthPhoto {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private a: Pair | null = null;
  private b: Pair | null = null;
  private mix = 0;
  private mixStart = 0;
  private look = { x: 0, y: 0 };
  private target = { x: 0, y: 0 };
  private touched = 0;
  private raf = 0;
  private shown = true;
  private born = performance.now();
  private still = calm();
  private dead = false;
  private token = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: {
      /** Tamanho do deslocamento (fração da foto). */
      amount?: number;
      /** A cada quadro: o ângulo atual (-1 a 1), para a moldura girar junto. */
      onFrame?: (x: number, y: number) => void;
      /** WebGL caiu (contexto perdido): quem usa volta para a foto parada. */
      onLost?: () => void;
    } = {},
  ) {
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      powerPreference: 'low-power',
    });
    if (!gl) throw new Error('sem WebGL');
    this.gl = gl;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('programa');
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uPhotoA', 'uDepthA', 'uPhotoB', 'uDepthB', 'uLook', 'uCover', 'uMix'])
      this.u[n] = gl.getUniformLocation(prog, n);
    this.u.uAmount = gl.getUniformLocation(prog, 'uAmount');
    gl.uniform1i(this.u.uPhotoA!, 0);
    gl.uniform1i(this.u.uDepthA!, 1);
    gl.uniform1i(this.u.uPhotoB!, 2);
    gl.uniform1i(this.u.uDepthB!, 3);
    gl.uniform1f(this.u.uAmount!, opts.amount ?? 0.055);
    canvas.addEventListener('webglcontextlost', this.lost);
  }

  private lost = (e: Event) => {
    e.preventDefault();
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.opts.onLost?.();
  };

  private texture(img: HTMLImageElement): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    return t;
  }

  private bind(unit: number, t: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, t);
  }

  private drop(p: Pair | null) {
    if (!p) return;
    this.gl.deleteTexture(p.photo);
    this.gl.deleteTexture(p.depth);
  }

  /** Mostra outro prato (a primeira vez direto; depois, a foto nova aparece por cima). */
  async show(scene: DepthScene): Promise<void> {
    const my = ++this.token;
    const [photo, depth] = await Promise.all([loadImage(scene.photo), loadImage(scene.depth)]);
    if (this.dead || my !== this.token) return;
    const pair: Pair = {
      photo: this.texture(photo),
      depth: this.texture(depth),
      aspect: photo.naturalWidth / Math.max(1, photo.naturalHeight),
    };
    if (!this.a || this.still) {
      this.drop(this.a);
      this.drop(this.b);
      this.a = pair;
      this.b = null;
      this.mix = 0;
    } else {
      this.drop(this.b);
      this.b = pair;
      this.mix = 0;
      this.mixStart = performance.now();
    }
    // Um quadro já, mesmo fora da tela: o canvas nunca aparece vazio por cima da foto.
    this.draw();
    this.kick();
  }

  /** Ângulo pedido pelo mouse ou pelo dedo, de -1 a 1. */
  point(x: number, y: number) {
    this.target.x = Math.max(-1, Math.min(1, x));
    this.target.y = Math.max(-1, Math.min(1, y));
    this.touched = performance.now();
    this.kick();
  }

  /** Soltou: o ângulo volta a passear sozinho. */
  release() {
    this.touched = performance.now() - 1200;
    this.kick();
  }

  /** Na tela ou fora dela (fora, o laço para). */
  setShown(on: boolean) {
    this.shown = on;
    if (on) this.kick();
    else cancelAnimationFrame(this.raf);
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.drop(this.a);
    this.drop(this.b);
    this.gl.deleteProgram(this.prog);
  }

  private kick() {
    if (this.dead || !this.shown) return;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    if (this.dead || !this.a) return;
    let busy = false;
    if (!this.still) {
      // Sem mexer por 2,5 s: o ângulo passeia sozinho, devagar (uma volta em ~14 s).
      if (now - this.touched > 2500) {
        const t = (now - this.born) / 1000;
        this.target.x = Math.sin(t * 0.45) * 0.75;
        this.target.y = Math.sin(t * 0.31 + 1) * 0.4;
      }
      this.look.x += (this.target.x - this.look.x) * 0.06;
      this.look.y += (this.target.y - this.look.y) * 0.06;
      busy = true;
      if (this.b) {
        this.mix = Math.min(1, (now - this.mixStart) / 420);
        if (this.mix >= 1) {
          this.drop(this.a);
          this.a = this.b;
          this.b = null;
          this.mix = 0;
        }
      }
    }
    this.draw();
    this.opts.onFrame?.(this.look.x, this.look.y);
    if (busy) this.raf = requestAnimationFrame(this.frame);
  };

  private draw() {
    const gl = this.gl;
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    gl.viewport(0, 0, w, h);
    const a = this.a!;
    // Cobre a moldura sem esticar a foto, com 6% de folga para o deslocamento não sair da borda.
    const box = w / h;
    const zoom = 0.94;
    const sx = box > a.aspect ? 1 : box / a.aspect;
    const sy = box > a.aspect ? a.aspect / box : 1;
    gl.uniform2f(this.u.uCover!, sx * zoom, sy * zoom);
    gl.uniform2f(this.u.uLook!, this.look.x, this.look.y);
    gl.uniform1f(this.u.uMix!, this.b ? this.mix : 0);
    this.bind(0, a.photo);
    this.bind(1, a.depth);
    this.bind(2, (this.b ?? a).photo);
    this.bind(3, (this.b ?? a).depth);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
