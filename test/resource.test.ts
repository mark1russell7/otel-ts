import { describe, expect, it } from "vitest";
import { browserAttributes } from "../src/resource.js";

describe("browserAttributes", () => {
  it("reads the User-Agent Client Hints, the language and the user agent", () => {
    expect(
      browserAttributes({
        userAgent: "Mozilla/5.0 Chrome/145",
        language: "en-US",
        userAgentData: {
          brands: [
            { brand: "Chromium", version: "145" },
            { brand: "Not A;Brand", version: "99" },
          ],
          mobile: false,
          platform: "Windows",
        },
      }),
    ).toEqual({
      "browser.brands": ["Chromium 145", "Not A;Brand 99"],
      "browser.platform": "Windows",
      "browser.mobile": false,
      "browser.language": "en-US",
      "user_agent.original": "Mozilla/5.0 Chrome/145",
    });
  });

  it("leaves out what the browser does not give, as in Firefox and Safari", () => {
    expect(browserAttributes({ userAgent: "Mozilla/5.0 Firefox/146", language: "de" })).toEqual({
      "browser.language": "de",
      "user_agent.original": "Mozilla/5.0 Firefox/146",
    });
    expect(
      browserAttributes({ userAgent: "", language: "", userAgentData: { brands: [], platform: "" } }),
    ).toEqual({});
  });

  it("gives nothing where there is no navigator", () => {
    expect(browserAttributes(undefined)).toEqual({});
  });
});
