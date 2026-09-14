const buttons=[...document.querySelectorAll('[data-tool]')];
buttons.forEach(btn=>btn.addEventListener('click',()=>{buttons.forEach(b=>b.classList.toggle('active',b===btn));window.miniMeet.annotationToolCommand({type:'tool',value:btn.dataset.tool});}));
document.querySelector('#color').addEventListener('input',e=>window.miniMeet.annotationToolCommand({type:'color',value:e.target.value}));
document.querySelector('#size').addEventListener('input',e=>window.miniMeet.annotationToolCommand({type:'size',value:Number(e.target.value)}));
document.querySelector('#clear').addEventListener('click',()=>window.miniMeet.annotationToolCommand({type:'clear'}));
document.querySelector('#close').addEventListener('click',()=>window.miniMeet.closeAnnotation());
