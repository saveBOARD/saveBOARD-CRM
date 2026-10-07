import { describe, expect, it } from "vitest";
import { addressesFromMe } from "./graph";

describe("addressesFromMe", () => {
  it("collects the primary mail, sign-in name, other mails and smtp aliases", () => {
    expect(
      addressesFromMe({
        mail: "paul@saveboard.nz",
        userPrincipalName: "paul@saveboard.onmicrosoft.com",
        otherMails: ["paul.c@example.com"],
        proxyAddresses: ["SMTP:paul@saveboard.nz", "smtp:paul@saveboard.com.au", "SIP:paul@saveboard.nz", "X500:/o=xyz"],
      }),
    ).toEqual(["paul@saveboard.nz", "paul@saveboard.onmicrosoft.com", "paul.c@example.com", "paul@saveboard.nz", "paul@saveboard.com.au"]);
  });

  it("copes with missing fields", () => {
    expect(addressesFromMe({ userPrincipalName: "iris@saveboard.onmicrosoft.com" })).toEqual(["iris@saveboard.onmicrosoft.com"]);
  });
});
