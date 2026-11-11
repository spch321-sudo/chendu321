/* 晨讀321 × 321 共用帳號（ES5 外掛；需要 ../321steward/k321acct.js）
 * ‧「備份與還原」上方加一張「321 共用帳號」卡片
 * ‧ 登入後自動加密備份進度、畫線、領受（位置 'chendu-zh'／'chendu-zs'／'chendu-en'，三個語言版本各自一份）
 * ‧ 把晨讀進度公開給 321管家（位置 'chendu-pub'）：讀過幾課、連續天數、最近一課 */
(function(){
 var A=window.K321ACCT;if(!A)return;
 var P=/sc\.html/.test(location.pathname)?'zs':(/en\.html/.test(location.pathname)?'en':'zh');
 var SLOT='chendu-'+P;
 var TX={
  zh:{t:'321 共用帳號',d:'一組帳號碼，所有 321 App 共用：自動加密備份進度、畫線與領受，換手機找回；讀經進度也會出現在 321管家。',open:'建立或登入 321 帳號',on:'已登入',last:'上次同步：',never:'尚未同步',sync:'⟳ 立即同步',acct:'帳號碼與登出',synced:'已同步到 321 帳號',fail:'同步失敗：',ask:'321 帳號裡有你的晨讀321備份，要下載到這支手機嗎？會取代這支手機上的進度、畫線與領受。'},
  zs:{t:'321 共用账号',d:'一组账号码，所有 321 App 共用：自动加密备份进度、画线与领受，换手机找回；读经进度也会出现在 321管家。',open:'建立或登录 321 账号',on:'已登录',last:'上次同步：',never:'尚未同步',sync:'⟳ 立即同步',acct:'账号码与登出',synced:'已同步到 321 账号',fail:'同步失败：',ask:'321 账号里有你的晨读321备份，要下载到这部手机吗？会取代这部手机上的进度、画线与领受。'},
  en:{t:'321 Account',d:'One code for every 321 app: encrypted backup of your progress, highlights and notes, restored on a new phone; your progress also appears in the 321 Steward.',open:'Create or sign in to a 321 Account',on:'Signed in',last:'Last sync: ',never:'Not synced yet',sync:'⟳ Sync now',acct:'Account code / sign out',synced:'Synced to your 321 Account',fail:'Sync failed: ',ask:'Your 321 Account has a Morning Reading backup. Download it to this phone? It replaces progress, highlights and notes here.'}
 }[P];
 function key(){try{return LS_KEY;}catch(e){return window.LS_KEY;}}
 function note(m){try{if(typeof uiToast==='function'){uiToast(m);return;}}catch(e){}}
 function st(){try{return state;}catch(e){return null;}}
 function lessons(){try{return LESSONS;}catch(e){return null;}}
 function summary(){
  var s=st()||{},ls=lessons()||[],read=0,k,last=null,i;
  for(k in (s.read||{}))if(s.read[k])read++;
  for(i=0;i<ls.length;i++)if(ls[i].n===s.last){last={no:String(ls[i].no||ls[i].n),title:String(ls[i].title||'').split('\n').join(' ')};break;}
  var notes=0,marks=0;for(k in (s.notes||{}))notes++;for(k in (s.marks||{}))marks++;
  return {v:1,at:Date.now(),lang:P,read:read,total:ls.length,streak:s.streak||0,best:s.best||0,lastDate:s.lastDate||'',last:last,notes:notes,marks:marks};
 }
 var busy=false,timer=null;
 function sync(cb){
  if(!A.get()||busy){if(cb)cb('busy');return;}busy=true;
  try{if(typeof saveState==='function')saveState._orig?saveState._orig():0;}catch(e){}
  var raw=null;try{raw=localStorage.getItem(key());}catch(e){}
  A.put(SLOT,{v:1,at:Date.now(),raw:raw},function(e1){A.put('chendu-pub',summary(),function(e2){busy=false;paint();if(cb)cb(e1||e2);});});
 }
 function soon(){if(!A.get())return;clearTimeout(timer);timer=setTimeout(function(){sync(null);},45000);}
 if(typeof window.saveState==='function'){var _ss=window.saveState;window.saveState=function(){var r=_ss.apply(this,arguments);soon();return r;};window.saveState._orig=_ss;}
 function restore(){
  A.fetch(SLOT,function(err,o){
   if(err||!o||!o.raw){sync(null);return;}
   if(confirm(TX.ask)){try{localStorage.setItem(key(),o.raw);}catch(e){}location.reload();}else sync(null);
  });
 }
 function changed(kind){if(kind==='login'){A.syncProfile();restore();}else if(kind==='create'){A.syncProfile();sync(function(e){note(e?TX.fail+e:TX.synced);});}paint();}
 function open(){A.open({lang:P,onChange:changed});}
 function html(){
  var a=A.get(),at=Math.max(A.lastAt(SLOT),A.lastAt('chendu-pub'));
  return '<div class="bk-head"><span class="bk-ic">🔑</span><div class="bk-tx"><div class="bk-t">'+TX.t+(a?' · <span style="color:#2A8550">'+TX.on+'</span>':'')+'</div><div class="bk-d">'+(a?(at?TX.last+new Date(at).toLocaleString():TX.never):TX.d)+'</div></div></div>'+
   '<div class="bk-btns">'+(a?'<button class="bk-btn bk-exp" onclick="K321C.sync()">'+TX.sync+'</button><button class="bk-btn" onclick="K321C.open()">'+TX.acct+'</button>':'<button class="bk-btn bk-exp" onclick="K321C.open()">'+TX.open+'</button>')+'</div>';
 }
 function paint(){var el=document.getElementById('k321cdcard');if(el)el.innerHTML=html();}
 function inject(){
  var bk=document.querySelector('.backup-card');if(!bk||document.getElementById('k321cdcard'))return;
  var d=document.createElement('div');d.className='backup-card';d.id='k321cdcard';d.style.marginBottom='12px';d.innerHTML=html();bk.parentNode.insertBefore(d,bk);
 }
 window.K321C={sync:function(){sync(function(e){note(e&&e!=='busy'?TX.fail+e:TX.synced);});},open:open};
 setInterval(inject,800);inject();
 setTimeout(function(){if(!A.get())return;A.syncProfile();if(Date.now()-A.lastAt('chendu-pub')>10*60000)sync(null);},4000);
 document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'&&A.get()&&Date.now()-A.lastAt('chendu-pub')>3*60000)sync(null);});
})();
