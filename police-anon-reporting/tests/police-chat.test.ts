import { describe, it, expect } from "vitest";
import { Cl } from "@stacks/transactions";

// The `simnet` object is provided globally by vitest-environment-clarinet.
const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const citizen1 = accounts.get("wallet_1")!;
const officer1 = accounts.get("wallet_2")!;

const REGION = "CENTRAL";

describe("police-chat contract", () => {
  it("allows admin to register and activate a police officer", () => {
    const register = simnet.callPublicFn(
      "police-chat",
      "register-police",
      [Cl.principal(officer1), Cl.stringAscii(REGION)],
      deployer
    );

    expect(register.result).toBeOk();

    const officer = simnet.callReadOnlyFn(
      "police-chat",
      "get-officer",
      [Cl.principal(officer1)],
      deployer
    );

    expect(officer.result).toBeOk();
  });

  it("lets a citizen open a case and chat with an assigned officer", () => {
    // Ensure officer is registered and active in the region
    const register = simnet.callPublicFn(
      "police-chat",
      "register-police",
      [Cl.principal(officer1), Cl.stringAscii(REGION)],
      deployer
    );
    expect(register.result).toBeOk();

    // Citizen opens a new case
    const salt = Buffer.alloc(32, 1);
    const openCase = simnet.callPublicFn(
      "police-chat",
      "open-case",
      [
        Cl.stringAscii(REGION),
        Cl.stringAscii("Noise complaint"),
        Cl.stringUtf8("Loud music every night at midnight"),
        Cl.buffer(salt),
      ],
      citizen1
    );

    expect(openCase.result).toBeOk();

    // After first case, next-case-id should be u2
    const nextId = simnet.getDataVar("police-chat", "next-case-id");
    expect(nextId).toBeUint(2);

    // Admin assigns case 1 to officer1
    const assign = simnet.callPublicFn(
      "police-chat",
      "assign-case",
      [Cl.uint(1), Cl.principal(officer1)],
      deployer
    );
    expect(assign.result).toBeOk();

    // Citizen sends a message on case 1
    const citizenMsg = simnet.callPublicFn(
      "police-chat",
      "send-citizen-message",
      [Cl.uint(1), Cl.stringUtf8("Please, can someone come to check?%)"],
      citizen1
    );
    expect(citizenMsg.result).toBeOk();

    // Officer replies on the same case
    const officerMsg = simnet.callPublicFn(
      "police-chat",
      "send-police-message",
      [Cl.uint(1), Cl.stringUtf8("We have dispatched a patrol to your area.")],
      officer1
    );
    expect(officerMsg.result).toBeOk();

    // There should be at least 2 messages recorded
    const count = simnet.callReadOnlyFn(
      "police-chat",
      "get-message-count",
      [Cl.uint(1)],
      citizen1
    );
    expect(count.result).toBeOk();
  });

  it("prevents unauthorized assignment and messaging, and enforces closed cases", () => {
    // Citizen opens a fresh case
    const salt = Buffer.alloc(32, 2);
    const openCase = simnet.callPublicFn(
      "police-chat",
      "open-case",
      [
        Cl.stringAscii(REGION),
        Cl.stringAscii("Suspicious activity"),
        Cl.stringUtf8("Unknown car circling the neighbourhood"),
        Cl.buffer(salt),
      ],
      citizen1
    );
    expect(openCase.result).toBeOk();

    // Citizen must not be able to assign the case
    const unauthorizedAssign = simnet.callPublicFn(
      "police-chat",
      "assign-case",
      [Cl.uint(2), Cl.principal(officer1)],
      citizen1
    );
    expect(unauthorizedAssign.result).toBeErr();

    // Admin assigns officer
    const assign = simnet.callPublicFn(
      "police-chat",
      "assign-case",
      [Cl.uint(2), Cl.principal(officer1)],
      deployer
    );
    expect(assign.result).toBeOk();

    // Random citizen must not be able to send police message
    const randomCitizen = accounts.get("wallet_3")!;
    const unauthorizedPoliceMsg = simnet.callPublicFn(
      "police-chat",
      "send-police-message",
      [Cl.uint(2), Cl.stringUtf8("This should not be accepted as police.")],
      randomCitizen
    );
    expect(unauthorizedPoliceMsg.result).toBeErr();

    // Officer can close the case
    const close = simnet.callPublicFn(
      "police-chat",
      "close-case",
      [Cl.uint(2)],
      officer1
    );
    expect(close.result).toBeOk();

    // After closure, further citizen messages should fail with ERR_CASE_CLOSED
    const msgAfterClose = simnet.callPublicFn(
      "police-chat",
      "send-citizen-message",
      [Cl.uint(2), Cl.stringUtf8("Are you still there?")],
      citizen1
    );
    expect(msgAfterClose.result).toBeErr(Cl.uint(201n));
  });
});
