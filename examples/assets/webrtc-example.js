const audioContext = document.querySelector("audio-context#audio");
const streamOutput = document.querySelector("audio-stream-output#rtc-output");
const remoteAudio = document.querySelector("audio#remote-audio");
const audioState = document.querySelector("[data-testid='audio-state']");
const senderState = document.querySelector("[data-testid='sender-state']");
const receiverState = document.querySelector("[data-testid='receiver-state']");
const remoteTrackState = document.querySelector("[data-testid='remote-track-state']");
const errorMessage = document.querySelector("[role='alert']");
const startButton = document.querySelector("#start");
const closeButton = document.querySelector("#close");

let sender = null;
let receiver = null;
let busy = false;
let closed = false;

const labelAudioState = () => {
  const value = audioContext.state;
  audioState.textContent = `${value[0].toUpperCase()}${value.slice(1)}`;
};

const render = () => {
  labelAudioState();
  senderState.textContent = sender?.connectionState ?? (closed ? "closed" : "new");
  receiverState.textContent = receiver?.connectionState ?? (closed ? "closed" : "new");
  startButton.disabled = busy || closed || sender !== null;
  closeButton.disabled = busy || closed;
};

const waitForIceGathering = (peer) => {
  if (peer.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const handleChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      peer.removeEventListener("icegatheringstatechange", handleChange);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", handleChange);
  });
};

const connectPeers = async (stream) => {
  sender = new RTCPeerConnection();
  receiver = new RTCPeerConnection();
  sender.addEventListener("connectionstatechange", render);
  receiver.addEventListener("connectionstatechange", render);
  receiver.addEventListener("track", (event) => {
    const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
    remoteAudio.muted = true;
    remoteAudio.srcObject = remoteStream;
    remoteTrackState.textContent = `${event.track.readyState} ${event.track.kind} track`;
  });

  for (const track of stream.getTracks()) sender.addTrack(track, stream);

  await sender.setLocalDescription(await sender.createOffer());
  await waitForIceGathering(sender);
  await receiver.setRemoteDescription(sender.localDescription);
  await receiver.setLocalDescription(await receiver.createAnswer());
  await waitForIceGathering(receiver);
  await sender.setRemoteDescription(receiver.localDescription);
  render();
};

startButton.addEventListener("click", async () => {
  if (busy || closed || sender !== null) return;
  busy = true;
  errorMessage.textContent = "";
  render();
  try {
    await audioContext.resume();
    await connectPeers(streamOutput.stream);
  } catch (error) {
    errorMessage.textContent = `${error.name}: ${error.message}`;
    sender?.close();
    receiver?.close();
    sender = null;
    receiver = null;
  } finally {
    busy = false;
    render();
  }
});

closeButton.addEventListener("click", async () => {
  if (busy || closed) return;
  busy = true;
  render();
  try {
    sender?.close();
    receiver?.close();
    await audioContext.close();
  } catch (error) {
    errorMessage.textContent = `${error.name}: ${error.message}`;
  } finally {
    closed = true;
    remoteAudio.srcObject = null;
    remoteTrackState.textContent = "closed";
    busy = false;
    render();
  }
});

audioContext.addEventListener("statechange", render);
render();
