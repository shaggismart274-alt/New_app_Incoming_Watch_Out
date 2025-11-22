// ui/app.ts
// Minimal UI wiring for the police-chat contract.
// This file focuses on how the forms conceptually map to Clarity function calls.
// To actually run it in a browser you would typically add a bundler (Vite) and
// integrate a wallet via @stacks/connect.

import { Cl } from "@stacks/transactions";

// TODO: fill these out for your deployment environment
const CONTRACT_ADDRESS = "STXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"; // deployer principal
const CONTRACT_NAME = "police-chat";

// Example of how a contract call payload might be created.
// You still need a signer / wallet integration to broadcast it.
async function callContractFunction(
  functionName: string,
  args: any[],
  sender: "citizen" | "police"
) {
  console.log("Pretend sending contract call", {
    contract: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
    functionName,
    args,
    sender,
  });
  // In a real app you would:
  // 1. Use `showContractCall` from `@stacks/connect`.
  // 2. Pass `functionName`, `functionArgs` (Clarity values built with `Cl.*`),
  //    `contractAddress`, `contractName`, and `network`.
  // 3. Let the user approve the transaction in their Stacks-compatible wallet.
}

// Read-only helper for fetching a single message (case-id, index)
async function fetchMessage(caseId: number, index: number) {
  console.log("Pretend reading message from Simnet / Devnet API", {
    contract: `${CONTRACT_ADDRESS}.${CONTRACT_NAME}`,
    fn: "get-message",
    caseId,
    index,
  });
  // In a real app you would call the Stacks API endpoint
  // `/v2/contracts/call-read/${CONTRACT_ADDRESS}/${CONTRACT_NAME}/get-message`.
}

function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id) as T | null;
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function setupOpenCaseForm() {
  const form = getEl<HTMLFormElement>("open-case-form");
  const statusEl = getEl<HTMLParagraphElement>("open-case-status");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const region = String(data.get("region") || "").toUpperCase();
    const subject = String(data.get("subject") || "");
    const details = String(data.get("details") || "");
    const saltString = String(data.get("salt") || "");

    // Derive a 32-byte salt buffer from user input (for demo only)
    const saltBytes = new Uint8Array(32);
    const src = new TextEncoder().encode(saltString || "citizen-anon-salt");
    saltBytes.set(src.subarray(0, 32));

    try {
      statusEl.textContent = "Preparing transaction to open anonymous case...";
      await callContractFunction(
        "open-case",
        [
          Cl.stringAscii(region),
          Cl.stringAscii(subject),
          Cl.stringUtf8(details),
          Cl.buffer(Buffer.from(saltBytes)),
        ],
        "citizen"
      );
      statusEl.textContent =
        "Transaction prepared. Use your Stacks wallet to broadcast the anonymous case report.";
      form.reset();
    } catch (error) {
      console.error(error);
      statusEl.textContent = "Failed to prepare open-case transaction (see console).";
    }
  });
}

function setupSendMessageForm() {
  const form = getEl<HTMLFormElement>("send-message-form");
  const statusEl = getEl<HTMLParagraphElement>("send-message-status");
  const caseIdInput = getEl<HTMLInputElement>("current-case-id");
  const roleSelect = getEl<HTMLSelectElement>("role-select");
  const messagesList = getEl<HTMLDivElement>("messages-list");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const textArea = getEl<HTMLTextAreaElement>("message-input");
    const content = textArea.value.trim();
    const role = roleSelect.value as "citizen" | "police";
    const caseId = Number(caseIdInput.value || "0");

    if (!caseId) {
      statusEl.textContent = "Select or enter a case ID before sending messages.";
      return;
    }

    if (!content) {
      statusEl.textContent = "Message cannot be empty.";
      return;
    }

    const fn = role === "citizen" ? "send-citizen-message" : "send-police-message";

    try {
      statusEl.textContent = `Preparing ${role} message transaction...`;
      await callContractFunction(
        fn,
        [Cl.uint(caseId), Cl.stringUtf8(content)],
        role
      );
      statusEl.textContent =
        "Message transaction prepared. Once mined, it will appear in the case chat history.";

      // Optimistic UI append
      const div = document.createElement("div");
      div.className = `message ${role}`;
      div.innerHTML = `
        <div class="message-meta">
          <span class="badge ${role === "citizen" ? "role-citizen" : "role-police"}">
            ${role === "citizen" ? "Citizen" : "Police"}
          </span>
          <span>pending on-chain...</span>
        </div>
        <div>${content}</div>
      `;
      messagesList.appendChild(div);
      textArea.value = "";
    } catch (error) {
      console.error(error);
      statusEl.textContent = "Failed to prepare message transaction (see console).";
    }
  });
}

function setupCaseBoard() {
  const casesList = getEl<HTMLDivElement>("cases-list");
  const currentCaseId = getEl<HTMLInputElement>("current-case-id");
  const refreshBtn = getEl<HTMLButtonElement>("refresh-cases-btn");

  // For now this just shows static example entries.
  function renderExampleCases() {
    casesList.innerHTML = "";
    const example = [
      { id: 1, region: "CENTRAL", subject: "Noise complaint", status: "open" },
      { id: 2, region: "CENTRAL", subject: "Suspicious vehicle", status: "closed" },
    ];

    for (const c of example) {
      const div = document.createElement("div");
      div.className = "case-item";
      div.dataset["id"] = String(c.id);
      div.innerHTML = `
        <strong>#${c.id}</strong> ${c.subject}<br />
        <span class="message-meta">Region: ${c.region} • Status: ${c.status}</span>
      `;
      div.addEventListener("click", () => {
        currentCaseId.value = String(c.id);
        for (const child of casesList.querySelectorAll(".case-item")) {
          child.classList.remove("active");
        }
        div.classList.add("active");
      });
      casesList.appendChild(div);
    }
  }

  refreshBtn.addEventListener("click", () => {
    // In a real dApp, this would:
    // 1. Query the contract for known case IDs and status (e.g., via an indexer or
    //    additional read-only functions).
    // 2. Filter by the officer's region.
    // For this demo we just render hard-coded examples.
    renderExampleCases();
  });

  renderExampleCases();
}

function main() {
  setupOpenCaseForm();
  setupSendMessageForm();
  setupCaseBoard();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
