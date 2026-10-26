from datetime import date

from pydantic import BaseModel, model_validator


class TransactionCsvReportRequest(BaseModel):
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _ordered_dates(self) -> "TransactionCsvReportRequest":
        if self.start_date > self.end_date:
            raise ValueError("The start date is after the end date.")
        return self


class TransactionCsvReportResponse(BaseModel):
    message: str
