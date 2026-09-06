import "../../src/event-source/event-source.js";

describe("event-source individual registration", () => {
  it("registers the event-source element from its subpath entry", () => {
    if (typeof customElements.get("event-source") !== "function") {
      throw new Error("expected <event-source> to be registered");
    }
  });
});
