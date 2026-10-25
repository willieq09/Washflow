import { auth } from '../lib/firebase';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload) {
  try {
    // The server only sends emails for signed-in users, so include who we are.
    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) return false;
    const response = await fetch('/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.json();
      console.warn('Failed to send email:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('Email notification error:', error);
    return false;
  }
}

export function generateBookingNotification(booking: any, recipientName: string, role: 'owner' | 'customer' | 'worker') {
  const date = booking.slot?.toDate ? booking.slot.toDate().toLocaleString() : 'TBD';
  
  const subjects = {
    owner: `New Booking: ${booking.businessName}`,
    customer: `Booking Confirmed: ${booking.businessName}`,
    worker: `New Task Assigned: ${booking.businessName}`
  };

  const messages = {
    owner: `Hi ${recipientName}, you have a new booking from a customer. <br/><br/> <b>Details:</b><br/> Vehicle: ${booking.vehicleInfo}<br/> Date: ${date}<br/> Type: ${booking.serviceType}`,
    customer: `Hi ${recipientName}, your booking at ${booking.businessName} has been confirmed. <br/><br/> <b>Details:</b><br/> Date: ${date}<br/> Type: ${booking.serviceType}`,
    worker: `Hi ${recipientName}, you have been assigned to a new wash task. <br/><br/> <b>Details:</b><br/> Station: ${booking.businessName}<br/> Date: ${date}<br/> Type: ${booking.serviceType}`
  };

  return {
    subject: subjects[role],
    html: `
      <div style="font-family: sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #000;">NearWash Notification</h2>
        <p>${messages[role]}</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;"/>
        <p style="font-size: 12px; color: #999;">This is an automated message from NearWash. Please do not reply.</p>
      </div>
    `
  };
}
