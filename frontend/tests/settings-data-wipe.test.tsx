import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { signedIn } from "./helpers";
import { renderApp } from "./renderApp";
import { server } from "./server";

beforeEach(() => {
  signedIn();
});

describe("settings data wipe", () => {
  it("requests a code then confirms wipe with the typed code", async () => {
    let confirmBody: unknown;
    server.use(
      http.post("/api/v1/data-wipe/request", () =>
        HttpResponse.json(
          { message: "A verification code was sent to your email." },
          { status: 202 },
        ),
      ),
      http.post("/api/v1/data-wipe/confirm", async ({ request }) => {
        confirmBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApp("/settings");
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: /wipe finance data/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send verification code/i }));

    expect(
      await screen.findByText(/verification code was sent to your email/i),
    ).toBeInTheDocument();
    const codeField = screen.getByLabelText(/verification code/i);
    await user.type(codeField, "123456");
    await user.click(screen.getByRole("button", { name: /wipe all finance data/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/wiped/i);
    });
    expect(confirmBody).toEqual({ code: "123456" });
  });

  it("shows an API error when the code cannot be sent", async () => {
    server.use(
      http.post("/api/v1/data-wipe/request", () =>
        HttpResponse.json(
          {
            error: {
              code: "service_unavailable",
              message: "Email delivery is required to wipe data.",
            },
          },
          { status: 503 },
        ),
      ),
    );

    renderApp("/settings");
    await userEvent.setup().click(
      await screen.findByRole("button", { name: /send verification code/i }),
    );
    expect(
      await screen.findByText(/email delivery is required to wipe data/i),
    ).toBeInTheDocument();
  });
});
