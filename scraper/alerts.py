"""
Email alerts via Resend when new golden slots appear.
"""
import os
import resend
from datetime import date

resend.api_key = os.environ.get("RESEND_API_KEY", "")

FROM_EMAIL = "Maine BMV Slots <alerts@mainebmvslots.com>"  # update after domain setup
# For testing before domain setup, Resend allows: onboarding@resend.dev


def format_date(d: date) -> str:
    return d.strftime("%B %-d, %Y")  # "February 13, 2026"


def send_golden_alert(
    to_emails: list[str],
    office: str,
    appt_date: date,
    appt_time: str,
    book_url: str,
) -> None:
    """Send email alert for a new golden slot."""
    if not resend.api_key or not to_emails:
        return

    date_str = format_date(appt_date)

    # Format time nicely: "14:00:00" → "2:00 PM"
    from datetime import datetime
    try:
        t = datetime.strptime(appt_time[:5], "%H:%M")
        time_str = t.strftime("%-I:%M %p")
    except Exception:
        time_str = appt_time

    subject = f"⚡ {office} — {date_str} at {time_str} — Book Now"

    html_body = f"""
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 8px; color: #111;">New Real ID Appointment</h2>
      <p style="margin: 0 0 24px; color: #555; font-size: 15px;">
        A short-notice slot just opened up at the Maine BMV.
      </p>

      <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <div style="font-size: 13px; color: #92400e; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">
          🏆 Golden Slot
        </div>
        <div style="font-size: 22px; font-weight: 700; color: #111;">{office}</div>
        <div style="font-size: 18px; color: #333; margin-top: 4px;">{date_str}</div>
        <div style="font-size: 18px; color: #333;">{time_str}</div>
      </div>

      <a href="{book_url}"
         style="display: inline-block; background: #111; color: #fff; padding: 12px 24px;
                border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px;">
        Book This Appointment →
      </a>

      <p style="margin: 24px 0 0; color: #999; font-size: 12px;">
        Slots go fast — this link takes you directly to the booking page.
        <br><br>
        You're receiving this because you signed up at mainebmv.vercel.app.
        <a href="#" style="color: #999;">Unsubscribe</a>
      </p>
    </div>
    """

    # Resend requires sending one at a time or use batch
    for email in to_emails:
        try:
            resend.Emails.send({
                "from": FROM_EMAIL,
                "to": [email],
                "subject": subject,
                "html": html_body,
            })
        except Exception as e:
            print(f"Failed to send alert to {email}: {e}")
