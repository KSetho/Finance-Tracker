import { useState } from "react";
import { useLogout } from "../api/auth";
import { ApiError } from "../api/client";
import { useConfirmDataWipe, useRequestDataWipe } from "../api/dataWipe";
import { useEmailTransactionCsv } from "../api/reports";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../components/ui/Button";
import { DateField } from "../components/ui/DateField";
import { ErrorMessage } from "../components/ui/ErrorMessage";
import { TextField } from "../components/ui/TextField";
import { accraToday } from "../lib/dates";

const LOGOUT_ERROR = "Could not sign out. Check your connection and try again.";
const WIPE_SUCCESS = "All finance data was wiped. Your login was kept.";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function monthStartOnOrBefore(today: string): string {
  return `${today.slice(0, 7)}-01`;
}

export function SettingsPage() {
  const auth = useAuth();
  const logout = useLogout();
  const requestWipe = useRequestDataWipe();
  const confirmWipe = useConfirmDataWipe();
  const emailReport = useEmailTransactionCsv();
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [wiped, setWiped] = useState(false);
  const today = accraToday();
  const [startDate, setStartDate] = useState(() => monthStartOnOrBefore(today));
  const [endDate, setEndDate] = useState(today);

  const datesValid = Boolean(startDate && endDate && startDate <= endDate);

  const onRequestCode = () => {
    if (requestWipe.isPending) return;
    requestWipe.mutate(undefined, {
      onSuccess: () => {
        setCodeSent(true);
        setCode("");
        setWiped(false);
        confirmWipe.reset();
      },
    });
  };

  const onConfirmWipe = () => {
    if (confirmWipe.isPending || code.length !== 6) return;
    confirmWipe.mutate(code, {
      onSuccess: () => {
        setWiped(true);
        setCodeSent(false);
        setCode("");
        requestWipe.reset();
      },
    });
  };

  const onEmailReport = () => {
    if (emailReport.isPending || !datesValid) return;
    emailReport.mutate({ start_date: startDate, end_date: endDate });
  };

  return (
    <section>
      <h1>Settings</h1>
      <p className="muted">Signed in as {auth.user?.email}</p>
      {logout.isError ? (
        <p className="error-message" role="alert">
          {LOGOUT_ERROR}
        </p>
      ) : null}
      <Button type="button" onClick={() => logout.mutate()} disabled={logout.isPending}>
        Logout
      </Button>

      <div className="settings-section">
        <h2>Email transaction report</h2>
        <p className="muted">
          Emails a CSV of every transaction in the date range (income, expenses, transfers, and
          fees) to your owner email. At least one transaction must exist in the range.
        </p>
        <DateField
          label="From"
          value={startDate}
          max={endDate || today}
          onChange={(event) => setStartDate(event.target.value)}
        />
        <DateField
          label="To"
          value={endDate}
          min={startDate || undefined}
          max={today}
          onChange={(event) => setEndDate(event.target.value)}
        />
        {!datesValid && startDate && endDate ? (
          <ErrorMessage>The start date must be on or before the end date.</ErrorMessage>
        ) : null}
        {emailReport.isError ? (
          <ErrorMessage>
            {errorMessage(emailReport.error, "Could not send the report. Try again.")}
          </ErrorMessage>
        ) : null}
        {emailReport.isSuccess ? (
          <p role="status">{emailReport.data.message}</p>
        ) : null}
        <Button
          type="button"
          onClick={onEmailReport}
          disabled={emailReport.isPending || !datesValid}
        >
          {emailReport.isPending ? "Sending…" : "Email CSV report"}
        </Button>
      </div>

      <div className="danger-zone">
        <h2>Wipe finance data</h2>
        <p className="muted">
          Deletes accounts, transactions, transfers, budgets, and categories, then restores the
          default categories. Your email and password stay. A verification code is emailed to you
          before anything is deleted.
        </p>

        {wiped ? (
          <p role="status">{WIPE_SUCCESS}</p>
        ) : null}

        {requestWipe.isError ? (
          <ErrorMessage>{errorMessage(requestWipe.error, "Could not send the code.")}</ErrorMessage>
        ) : null}
        {confirmWipe.isError ? (
          <ErrorMessage>
            {errorMessage(confirmWipe.error, "Could not wipe data. Check the code and try again.")}
          </ErrorMessage>
        ) : null}

        {!codeSent ? (
          <Button
            type="button"
            variant="plain"
            className="btn-outline btn-danger-outline"
            onClick={onRequestCode}
            disabled={requestWipe.isPending}
          >
            {requestWipe.isPending ? "Sending code…" : "Send verification code"}
          </Button>
        ) : (
          <>
            <p role="status">
              {requestWipe.data?.message ?? "A verification code was sent to your email."}
            </p>
            <TextField
              label="Verification code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
            />
            <Button
              type="button"
              variant="plain"
              className="btn-outline btn-danger-outline"
              onClick={onConfirmWipe}
              disabled={confirmWipe.isPending || code.length !== 6}
            >
              {confirmWipe.isPending ? "Wiping…" : "Wipe all finance data"}
            </Button>
            <Button
              type="button"
              variant="plain"
              onClick={() => {
                setCodeSent(false);
                setCode("");
                confirmWipe.reset();
              }}
              disabled={confirmWipe.isPending}
            >
              Cancel
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
