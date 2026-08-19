self.addEventListener("message", (event) => {
  self.postMessage({ type: "echo", data: event.data });
});

self.postMessage({ type: "ready" });
