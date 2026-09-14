const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
let tool = 'pen';
let color = '#ff2d2d';
let size = 4;
let drawing = false;
let start = null;
let last = null;
let snapshot = null;

function resize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const image = canvas.width && canvas.height ? canvas.toDataURL() : null;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  if (image) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = image;
  }
}
resize();
addEventListener('resize', resize);

function point(e) {
  const r = canvas.getBoundingClientRect();
  const sx = canvas.width / r.width;
  const sy = canvas.height / r.height;
  return { x: (e.clientX-r.left)*sx, y: (e.clientY-r.top)*sy };
}

function applyStyle() {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = size * Math.max(1, devicePixelRatio || 1);
  ctx.strokeStyle = color; ctx.globalAlpha = tool === 'highlighter' ? .3 : 1;
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  if (tool === 'eraser') ctx.lineWidth *= 3;
}

function segment(a,b) {
  applyStyle(); ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
}

function shape(a,b) {
  if (snapshot) ctx.putImageData(snapshot,0,0);
  applyStyle();
  if (tool === 'rect') ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);
  if (tool === 'arrow') {
    const ang=Math.atan2(b.y-a.y,b.x-a.x), head=Math.max(16,size*4)*(devicePixelRatio||1);
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-head*Math.cos(ang-Math.PI/6),b.y-head*Math.sin(ang-Math.PI/6));ctx.moveTo(b.x,b.y);ctx.lineTo(b.x-head*Math.cos(ang+Math.PI/6),b.y-head*Math.sin(ang+Math.PI/6));ctx.stroke();
  }
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
}

canvas.addEventListener('pointerdown', e => { drawing=true; start=last=point(e); snapshot=ctx.getImageData(0,0,canvas.width,canvas.height); canvas.setPointerCapture?.(e.pointerId); });
canvas.addEventListener('pointermove', e => { if(!drawing)return; const p=point(e); if(['pen','highlighter','eraser'].includes(tool)){segment(last,p);last=p}else shape(start,p); });
canvas.addEventListener('pointerup', e => { if(!drawing)return; if(['rect','arrow'].includes(tool)) shape(start,point(e)); drawing=false;start=last=snapshot=null; });
canvas.addEventListener('pointercancel', () => {drawing=false;start=last=snapshot=null;});
window.miniMeet.onAnnotationCommand(cmd => {
  if (!cmd) return;
  if (cmd.type === 'tool') tool = cmd.value;
  if (cmd.type === 'color') color = cmd.value;
  if (cmd.type === 'size') size = Number(cmd.value) || 4;
  if (cmd.type === 'clear') ctx.clearRect(0,0,canvas.width,canvas.height);
});
