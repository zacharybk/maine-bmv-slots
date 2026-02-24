# Official Playwright Python image — Chromium pre-installed, no separate install step needed
FROM mcr.microsoft.com/playwright/python:v1.49.0-jammy

WORKDIR /app

# Install Python dependencies (playwright already in base image)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy scraper source
COPY . .

# Run the persistent loop runner
CMD ["python", "runner.py"]
