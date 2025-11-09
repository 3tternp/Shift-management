# Shift Management – Weekly Scheduler

A simple web app to generate weekly Morning, Day, and Night shift assignments for teams. It uses a fairness-aware random algorithm, supports week-to-week rotation, CSV export, and Excel/CSV import with per-day availability.

## Features

- Weekly schedule across Mon–Sun for three shifts: Morning, Day, Night
- Fairness-aware random assignment and rotation bias across weeks
- Avoids consecutive Night shifts where possible
- Excel/CSV import with optional `UnavailableDays` and `StaffPerShift`
- CSV export, no backend required

## Usage

1. Open `index.html` (or serve the folder):
   - `python -m http.server 5500` and visit `http://localhost:5500/`
2. Enter staff names or import Excel/CSV
3. Generate schedule and export as CSV

## Excel/CSV Columns

- `Name` (required)
- `UnavailableDays` (optional): e.g. `Mon, Wed, Fri`
- `StaffPerShift` (optional): integer; first detected numeric value is used

## Deployment

Host as static files (e.g., GitHub Pages, S3, Netlify). No server is required.

### GitHub Pages (recommended)

- This repository includes a workflow at `.github/workflows/deploy.yml`.
- On every push to `main`, it deploys the site to GitHub Pages.
- After the first run completes, your site will be available at:
  - `https://3tternp.github.io/Shift-management/`

If you see 404 initially, wait 1–2 minutes and refresh.

To run locally:
- `python -m http.server 5500` and visit `http://localhost:5500/`