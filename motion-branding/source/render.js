const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const [,, scene, dur, fps, outdir, variant, only] = process.argv;
(async()=>{
  const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
  await p.goto('file://'+path.resolve('brand/brand.html'));await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(500);
  fs.mkdirSync(outdir,{recursive:true});
  const n=Math.round(+dur*+fps);
  const frames=only?only.split(',').map(Number):[...Array(n).keys()];
  for(const i of frames){
    await p.evaluate(([s,t,v])=>window.renderFrame(s,t,v),[scene,i/+fps,variant||'a']);
    await p.screenshot({path:`${outdir}/f_${String(i).padStart(4,'0')}.png`,omitBackground:scene==='lt'||scene==='wm'});
  }
  await b.close();
})();
