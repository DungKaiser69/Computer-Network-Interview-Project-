// --- Configuration ---
const API_BASE = 'https://localhost:3000'; 
const QUESTION_TIME_LIMIT_SEC = 120; // 2 Minutes per question

const QUESTIONS = [
  '1. Can you tell me about yourself and your background?',
  '2. What would you consider your greatest strengths and weaknesses?',
  '3. How do you handle conflicts within a team?',
  '4. What do you know about our company and why do you want to work here?',
  '5. Where do you see yourself in the next three to five years?',
];

// --- DOM Elements ---
const startScreen = document.getElementById('start-screen');
const interviewScreen = document.getElementById('interview-screen');
const finishScreen = document.getElementById('finish-screen');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');

const tokenInput = document.getElementById('token');
const nameInput = document.getElementById('name');
const startSessionBtn = document.getElementById('start-session-btn');
const tokenError = document.getElementById('token-error'); 
const nameError = document.getElementById('name-error');

const questionHeader = document.getElementById('question-header');
const questionText = document.getElementById('question-text');
const videoPreview = document.getElementById('video-preview');
const timerEl = document.getElementById('timer');
const liveTranscriptEl = document.getElementById('live-transcript');

const nextBtn = document.getElementById('next-btn');
const finishBtn = document.getElementById('finish-btn');
const rerecordBtn = document.getElementById('rerecord-btn');

const uploadStatusContainer = document.getElementById('upload-status-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const statusText = document.getElementById('status');

// --- State Variables ---
let mediaRecorder;
let recordedChunks = [];
let localStream;
let sessionToken = '';
let sessionFolder = '';
let currentQuestionIndex = 0;

// Features State
let timerInterval;
let timeLeft = QUESTION_TIME_LIMIT_SEC;
let reRecordAvailable = true; // True means user can re-record this question
let recognition;
let currentTranscript = '';

// --- Speech Recognition Setup ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript;
      else interim += event.results[i][0].transcript;
    }
    liveTranscriptEl.innerText = interim || final || '...';
    if (final) currentTranscript += final + ' ';
  };
}

// --- Event Listeners ---
startSessionBtn.addEventListener('click', startSession);
nextBtn.addEventListener('click', () => stopRecordingAndUpload(false)); // False = not re-recording
finishBtn.addEventListener('click', () => stopRecordingAndUpload(false));
rerecordBtn.addEventListener('click', handleReRecord);

// --- 1. Start Session ---
async function startSession() {
  const token = tokenInput.value;
  const userName = nameInput.value;

  if (!token || !userName) {
    setStatus('Please enter both token and name.', true);
    return;
  }

  setStatus('Connecting...');
  startSessionBtn.innerHTML = 'Loading...';
  startSessionBtn.disabled = true;

  try {
    // Verify Token
    const verifyRes = await fetch(`${API_BASE}/api/verify-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!verifyRes.ok) {
        tokenInput.classList.add('input-error');
        tokenError.textContent = 'Error: Invalid Token'.toUpperCase(); 
        tokenError.style.visibility = 'visible';

        setStatus(''); 
        startSessionBtn.disabled = false;
        startSessionBtn.innerHTML = 'Log in';
        return; 
    }

    // Start Session
    const sessionRes = await fetch(`${API_BASE}/api/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, userName }),
    });
    if (!sessionRes.ok) throw new Error('Could not start session');
    
    const data = await sessionRes.json();
    sessionToken = token;
    sessionFolder = data.folder;

    // Get Camera
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    videoPreview.srcObject = localStream;

    // UI Update
    startScreen.classList.add('hidden');
    interviewScreen.classList.remove('hidden');
    progressContainer.classList.remove('hidden');
    setStatus('');

    startRecording();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`, true);
    startSessionBtn.disabled = false;
    startSessionBtn.innerHTML = 'Log in';
  }
}

// --- 2. Recording Logic ---
function startRecording() {
  // Reset State for new question
  recordedChunks = [];
  currentTranscript = '';
  liveTranscriptEl.innerText = '(Listening...)';
  
  // Update Text
  questionHeader.innerText = `Question ${currentQuestionIndex + 1}`;
  questionText.innerText = QUESTIONS[currentQuestionIndex];
  
  // Update Progress Bar
  const percent = ((currentQuestionIndex) / QUESTIONS.length) * 100;
  progressFill.style.width = `${percent}%`;

  // Reset Re-record button if this is a NEW question (logic handled in upload)
  updateButtonsState();

  // Start MediaRecorder
  mediaRecorder = new MediaRecorder(localStream, { mimeType: 'video/webm' });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.start();

  // Start Speech
  if (recognition) recognition.start();

  // Start Timer
  startTimer();
}

function startTimer() {
  clearInterval(timerInterval);
  timeLeft = QUESTION_TIME_LIMIT_SEC;
  updateTimerDisplay();
  
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) {
      // Time is up! Force move to next
      clearInterval(timerInterval);
      stopRecordingAndUpload(false); 
    }
  }, 1000);
}

function updateTimerDisplay() {
  const mins = Math.floor(timeLeft / 60);
  const secs = timeLeft % 60;
  timerEl.innerText = `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  
  if (timeLeft <= 10) timerEl.classList.add('timer-warning');
  else timerEl.classList.remove('timer-warning');
}

// --- 3. Stop & Handle Action ---
function stopRecordingAndUpload(isReRecording) {
  clearInterval(timerInterval);
  
  if (recognition) recognition.stop();
  
  // When recorder stops, we decide what to do based on 'isReRecording'
  mediaRecorder.onstop = () => {
    if (isReRecording) {
      // User clicked Re-record: Discard video, restart
      console.log("Discarding video, restarting...");
      startRecording();
    } else {
      // User clicked Next/Finish: Upload video
      uploadVideo();
    }
  };
  
  mediaRecorder.stop();
}

function handleReRecord() {
  if (!reRecordAvailable) return;
  reRecordAvailable = false; // Use up the life
  stopRecordingAndUpload(true); // true = yes, we are re-recording
}

function updateButtonsState() {
  // Re-record button logic
  if (reRecordAvailable) {
    rerecordBtn.disabled = false;
    rerecordBtn.innerText = "Re-record (1 left)";
  } else {
    rerecordBtn.disabled = true;
    rerecordBtn.innerText = "Re-record (Used)";
  }

  // Next/Finish logic
  if (currentQuestionIndex < QUESTIONS.length - 1) {
    nextBtn.classList.remove('hidden');
    finishBtn.classList.add('hidden');
  } else {
    nextBtn.classList.add('hidden');
    finishBtn.classList.remove('hidden');
  }
}

// --- 4. Upload Logic (With Progress) ---
function uploadVideo() {
  uploadStatusContainer.classList.remove('hidden');
  
  // Size Warning
  const blob = new Blob(recordedChunks, { type: 'video/webm' });
  const sizeMB = blob.size / (1024 * 1024);
  if (sizeMB > 50) {
    if(!confirm(`File is large (${sizeMB.toFixed(1)}MB). Upload anyway?`)) return;
  }

  const formData = new FormData();
  formData.append('token', sessionToken);
  formData.append('folder', sessionFolder);
  formData.append('questionIndex', currentQuestionIndex + 1);
  formData.append('transcript', currentTranscript.trim());
  formData.append('video', blob, `Q${currentQuestionIndex + 1}.webm`);

  // Use XMLHttpRequest for upload progress
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API_BASE}/api/upload-one`, true);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percentComplete = (e.loaded / e.total) * 100;
      uploadProgressFill.style.width = `${percentComplete}%`;
    }
  };

  xhr.onload = async () => {
    if (xhr.status === 200) {
      console.log("Upload success");
      uploadStatusContainer.classList.add('hidden');
      uploadProgressFill.style.width = '0%';

      // Move to next question
      currentQuestionIndex++;
      
      if (currentQuestionIndex < QUESTIONS.length) {
        // Reset re-record availability for the NEW question
        reRecordAvailable = true; 
        // Update global progress bar
        progressFill.style.width = `${(currentQuestionIndex / QUESTIONS.length) * 100}%`;
        startRecording();
      } else {
        finalizeSession();
      }
    } else {
      setStatus(`Upload Failed: ${xhr.statusText}`, true);
    }
  };

  xhr.onerror = () => {
    setStatus("Network Error during upload.", true);
  };

  xhr.send(formData);
}

// --- 5. Finalize ---
async function finalizeSession() {
  setStatus('Finalizing...');
  progressFill.style.width = '100%'; // Full bar
  
  try {
    await fetch(`${API_BASE}/api/session/finish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: sessionToken,
        folder: sessionFolder,
        questionsCount: currentQuestionIndex,
      }),
    });

    localStream.getTracks().forEach((t) => t.stop());
    videoPreview.srcObject = null;
    interviewScreen.classList.add('hidden');
    finishScreen.classList.remove('hidden');
    setStatus('');
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  }
}

function setStatus(msg, err = false) {
  statusText.innerText = msg;
  statusText.style.color = err ? 'red' : '#333';; 
  if (msg) {
    statusText.style.visibility = 'visible';
    statusText.style.display = 'block'; 
  } else {
    statusText.style.visibility = 'hidden';
  }
}