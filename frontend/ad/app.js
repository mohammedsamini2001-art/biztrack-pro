const scenes = [...document.querySelectorAll(".scene")];
const progress = [...document.querySelectorAll(".progress i")];

let current = 0;
let audioStarted = false;
let muted = false;
let audioCtx = null;

function initAudio(){
  if(audioStarted) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  audioStarted = true;

  playTone(520,0.08,"sine",0.035);
  setTimeout(() => playTone(780,0.12,"sine",0.025),90);
}

function playTone(freq,duration,type="sine",volume=0.04){
  if(muted || !audioCtx) return;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = type;
  osc.frequency.value = freq;

  gain.gain.setValueAtTime(0.0001,audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(volume,audioCtx.currentTime+0.01);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    audioCtx.currentTime+duration
  );

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime+duration+0.02);
}

function transitionSound(){
  playTone(420,0.08,"sine",0.025);

  setTimeout(()=>{
    playTone(680,0.10,"sine",0.035);
  },70);
}

function successSound(){
  playTone(520,0.08,"sine",0.03);

  setTimeout(()=>{
    playTone(780,0.12,"sine",0.04);
  },90);

  setTimeout(()=>{
    playTone(1040,0.16,"sine",0.045);
  },190);
}

function showScene(index){
  scenes.forEach((scene,i)=>{
    scene.classList.toggle("active",i === index);
  });

  progress.forEach((bar,i)=>{
    bar.classList.toggle("active",i === index);
  });

  if(audioStarted){
    transitionSound();

    if(index === 1){
      setTimeout(()=>playTone(900,0.07,"square",0.025),500);
      setTimeout(()=>playTone(1100,0.07,"square",0.025),900);
    }

    if(index === 2){
      setTimeout(successSound,500);
    }

    if(index === 3){
      setTimeout(successSound,400);
    }
  }
}

function nextScene(){
  current++;

  if(current >= scenes.length){
    current = 0;
  }

  showScene(current);
}

function createSoundButton(){
  const button = document.createElement("button");

  button.id = "soundButton";
  button.textContent = "🔊";
  button.setAttribute("aria-label","Toggle sound");

  Object.assign(button.style,{
    position:"absolute",
    right:"7%",
    top:"5%",
    zIndex:"50",
    width:"38px",
    height:"38px",
    borderRadius:"50%",
    border:"1px solid rgba(255,255,255,.18)",
    background:"rgba(7,17,31,.75)",
    color:"#fff",
    fontSize:"16px",
    cursor:"pointer",
    backdropFilter:"blur(10px)"
  });

  button.addEventListener("click",()=>{
    initAudio();

    muted = !muted;
    button.textContent = muted ? "🔇" : "🔊";

    if(!muted){
      successSound();
    }
  });

  document.querySelector(".ad").appendChild(button);
}

document.addEventListener("pointerdown",initAudio,{once:true});

createSoundButton();
showScene(0);

setInterval(nextScene,4500);
