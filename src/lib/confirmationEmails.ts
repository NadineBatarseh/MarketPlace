import emailjs from '@emailjs/browser';

async function sendEmail(params: { name: string; email: string; subject: string; message: string }): Promise<void> {
  if (!params.email) return;
  await emailjs.send(
    import.meta.env.VITE_EMAILJS_SERVICE_ID,
    import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
    params,
    { publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY }
  );
}

export async function sendOrderConfirmationEmail(params: {
  toEmail: string;
  customerName: string;
  orderId: string | number;
  totalPrice: string | number;
  deliveryAddress: string;
}): Promise<void> {
  await sendEmail({
    name: params.customerName || 'عميلنا العزيز',
    email: params.toEmail,
    subject: 'تأكيد الطلب - سوق لينك',
    message:
      `شكراً لطلبك من سوق لينك!\n\n` +
      `رقم الطلب: ${params.orderId}\n` +
      `الإجمالي: ${params.totalPrice} ₪\n` +
      `عنوان التوصيل: ${params.deliveryAddress || '-'}\n\n` +
      `سنقوم بتجهيز طلبك وتوصيله في أقرب وقت.`,
  });
}

export async function sendDeliveryApplicationEmail(params: {
  toEmail: string;
  applicantName: string;
  vehicleType: string;
  submissionId: string;
}): Promise<void> {
  await sendEmail({
    name: params.applicantName || 'المتقدم',
    email: params.toEmail,
    subject: 'تم استلام طلب الانضمام كسائق - سوق لينك',
    message:
      `شكراً لتقديمك طلب الانضمام كسائق توصيل في سوق لينك.\n\n` +
      `نوع المركبة: ${params.vehicleType}\n` +
      `رقم الطلب: ${params.submissionId || '-'}\n\n` +
      `سنقوم بمراجعة طلبك والتواصل معك خلال أيام قليلة.`,
  });
}

export async function sendMerchantApplicationEmail(params: {
  toEmail: string;
  applicantName: string;
  storeName: string;
  submissionId: string;
}): Promise<void> {
  await sendEmail({
    name: params.applicantName || 'صاحب المتجر',
    email: params.toEmail,
    subject: 'تم استلام طلب انضمام متجرك - سوق لينك',
    message:
      `شكراً لتقديمك طلب انضمام متجر "${params.storeName}" إلى سوق لينك.\n\n` +
      `رقم الطلب: ${params.submissionId || '-'}\n\n` +
      `سنقوم بمراجعة طلبك والتواصل معك خلال أيام قليلة.`,
  });
}
