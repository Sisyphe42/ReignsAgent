import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cancelledText,
  classifyAiFailure,
  describeAiFailure,
  httpStatusOf,
  joinSentences,
  repairStopLabel,
  toSentence
} from "../../apps/creator-web/src/ai-status-copy.js";

describe("AI status copy: sentences", () => {
  it("never doubles the final punctuation", () => {
    assert.equal(toSentence("Raise it in Settings or restart the Creator."), "Raise it in Settings or restart the Creator.");
    assert.equal(toSentence("Unknown API route"), "Unknown API route.");
    assert.equal(toSentence("Wait!.."), "Wait.");
    assert.equal(toSentence("Loading…"), "Loading…");
    assert.equal(toSentence("  "), "");
    assert.equal(
      joinSentences("This Creator session reached its AI request limit (60). Raise it in Settings or restart the Creator.", "Nothing was applied"),
      "This Creator session reached its AI request limit (60). Raise it in Settings or restart the Creator. Nothing was applied."
    );
    assert.equal(joinSentences("A.", "", null, "B"), "A. B.");
  });

  it("reads an HTTP status from the failure or its message", () => {
    assert.equal(httpStatusOf({ status: 502 }), 502);
    assert.equal(httpStatusOf({ message: "AI endpoint request failed with status 503" }), 503);
    assert.equal(httpStatusOf({ message: "no status here" }), null);
  });
});

describe("AI status copy: failure notices", () => {
  it("treats the author's cancel as a neutral state that keeps finished rounds", () => {
    const notice = describeAiFailure({ code: "ai_cancelled", message: "AI request cancelled by the author", loop: { round: 2, maxRounds: 3 } });
    assert.equal(notice.kind, "cancelled");
    assert.equal(notice.tone, "neutral");
    assert.equal(notice.title, "Cancelled");
    assert.match(notice.text, /during round 2 of 3/);
    assert.match(notice.text, /Round 1 had finished and is kept in the repair history/);
    assert.match(notice.text, /No card was changed\./);
    assert.deepEqual(notice.actions, ["rebuild", "edit"]);
    assert.doesNotMatch(notice.text, /fail/i);
    // The message alone is enough to recognise a cancel (older events carry no code).
    assert.equal(classifyAiFailure({ message: "AI request cancelled by the author" }), "cancelled");
    assert.match(cancelledText(null), /no card was changed/i);
    assert.match(cancelledText({ round: 1, maxRounds: 3 }), /No round had finished yet/);
    assert.match(cancelledText({ round: 3, maxRounds: 3 }), /Rounds 1–2 had finished and are kept/);
  });

  it("asks to retry later, not to edit the prompt, when the endpoint is unavailable", () => {
    for (const failure of [
      { code: "endpoint_http_error", message: "AI endpoint request failed with status 503" },
      { code: "endpoint_http_error", message: "AI endpoint request failed with status 500" },
      { code: "endpoint_http_error", message: "AI endpoint request failed with status 429" },
      { code: "endpoint_network_error", message: "AI endpoint request failed: fetch failed" },
      { code: "endpoint_timeout", message: "AI endpoint request timed out" }
    ]) {
      const notice = describeAiFailure({ ...failure, stepLabel: "Request" });
      assert.equal(notice.kind, "unavailable", failure.message);
      assert.equal(notice.tone, "error");
      assert.equal(notice.title, "Endpoint unavailable");
      assert.match(notice.text, /retry/i);
      assert.match(notice.text, /not caused by your prompt/);
      assert.doesNotMatch(notice.text, /Edit the prompt/i);
      assert.deepEqual(notice.actions, ["retry"]);
      assert.doesNotMatch(notice.text, /\.\./);
    }
    assert.match(describeAiFailure({ code: "endpoint_http_error", message: "AI endpoint request failed with status 503" }).text, /temporarily unavailable/);
    assert.match(describeAiFailure({ code: "endpoint_timeout", message: "AI endpoint request timed out" }).text, /did not answer in time/);
  });

  it("suggests editing the prompt for request and response problems", () => {
    for (const failure of [
      { code: "endpoint_http_error", message: "AI endpoint request failed with status 400" },
      { code: "endpoint_http_error", message: "AI endpoint request failed with status 422" },
      { code: "endpoint_parse_error", message: "AI endpoint response contains invalid JSON: Unexpected token" },
      { code: "endpoint_invalid_response", message: "AI endpoint response must contain a proposals array" },
      { code: "ai_repair_no_valid_response", message: "Repair loop produced no usable proposals (max_rounds)" }
    ]) {
      const notice = describeAiFailure({ ...failure, stepLabel: "Response" });
      assert.equal(notice.kind, "prompt", failure.message);
      assert.equal(notice.title, "Draft failed");
      assert.match(notice.text, /^Failed at the Response step: /);
      assert.match(notice.text, /Edit the prompt or retry\.$/);
      assert.doesNotMatch(notice.text, /\.\./);
    }
  });

  it("points authentication and routing failures at Settings", () => {
    for (const status of [401, 403, 404]) {
      const notice = describeAiFailure({ code: "endpoint_http_error", message: `AI endpoint request failed with status ${status}` });
      assert.equal(notice.kind, "config");
      assert.match(notice.text, /in Settings/);
      assert.deepEqual(notice.actions, ["settings", "retry"]);
    }
  });

  it("shows the session limit without doubled punctuation or retry advice", () => {
    for (const message of [
      "This Creator session reached its AI request limit (60). Raise it in Settings or restart the Creator.",
      "This Creator session reached its AI request limit (60). Raise it in Settings or reload the page."
    ]) {
      const notice = describeAiFailure({ code: "ai_session_budget", message, stepLabel: "Request" });
      assert.equal(notice.kind, "limit");
      assert.equal(notice.title, "Request limit reached");
      assert.doesNotMatch(notice.text, /\.\./);
      assert.doesNotMatch(notice.text, /Edit the prompt|retry/i);
      assert.deepEqual(notice.actions, ["settings"]);
    }
  });

  it("keeps a generic fallback when nothing is known", () => {
    const notice = describeAiFailure({});
    assert.equal(notice.kind, "unknown");
    assert.equal(notice.text, "AI Assist draft failed. Check the status bar, edit the prompt, or retry.");
  });
});

describe("AI status copy: repair-loop stop reasons", () => {
  const verification = (overrides) => ({ limits: { maxRounds: 3 }, rounds: [{}, {}], roundsUsed: 2, selectedRound: 2, ...overrides });

  it("names the round in which a proposal passed", () => {
    assert.equal(
      repairStopLabel(verification({ stopReason: "verified" })),
      "Passed in round 2 of 3: the first proposal that cleared every blocking check."
    );
    assert.equal(
      repairStopLabel({ stopReason: "verified", selectedRound: 1, roundsUsed: 1, maxRounds: 3 }),
      "Passed in round 1 of 3: the first proposal that cleared every blocking check."
    );
    assert.doesNotMatch(repairStopLabel(verification({ stopReason: "verified" })), /first round/);
  });

  it("names the rounds for every other loop stop", () => {
    assert.equal(
      repairStopLabel(verification({ stopReason: "max_rounds", rounds: [{}, {}, {}], roundsUsed: 3, selectedRound: 1 })),
      "Reached the round limit after round 3 of 3 without a proposal that cleared every blocking check. Showing round 1, the best scored so far."
    );
    assert.equal(
      repairStopLabel(verification({ stopReason: "endpoint_error", selectedRound: 1 })),
      "The endpoint failed in round 2 of 3. Showing round 1, the best scored so far."
    );
    assert.equal(
      repairStopLabel(verification({ stopReason: "model_stopped", agentStop: { round: 2, reason: "needs the author" } })),
      "Stopped by the model in round 2 of 3: it reported that the targets cannot be fixed without the author. Showing round 2, the best scored so far."
    );
    assert.match(repairStopLabel(verification({ stopReason: "deadline", selectedRound: 1 })), /^Stopped at the loop deadline after round 2 of 3\. Showing round 1/);
    assert.match(repairStopLabel(verification({ stopReason: "ai_repair_total_budget" })), /^Stopped at the total byte budget after round 2 of 3\./);
    assert.match(repairStopLabel(verification({ stopReason: "ai_repair_request_budget", selectedRound: 1 })), /^Stopped in round 2 of 3: its request exceeded the byte budget\./);
    assert.match(repairStopLabel({ stopReason: "ai_cancelled", roundsUsed: 2, maxRounds: 3 }), /^Cancelled by the author in round 2 of 3\./);
    assert.equal(repairStopLabel({ stopReason: "offline_single_round" }), "Local rule-based repair runs once; asking again would return the same proposals.");
    assert.equal(repairStopLabel({ stopReason: "something_new" }), "something_new");
    assert.equal(repairStopLabel(null), "");
  });

  it("never produces doubled punctuation", () => {
    for (const stopReason of ["verified", "max_rounds", "endpoint_error", "deadline", "total_byte_budget", "ai_repair_request_budget", "ai_repair_response_budget", "ai_repair_total_budget", "model_stopped", "ai_cancelled"]) {
      assert.doesNotMatch(repairStopLabel(verification({ stopReason })), /\.\.|\. \./, stopReason);
      assert.doesNotMatch(repairStopLabel({ stopReason }), /\.\.|\. \./, `${stopReason} without numbers`);
    }
  });
});
