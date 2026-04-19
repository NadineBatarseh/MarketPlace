export const chatbotConfig = {
  merchant: {
    welcomeMessage: "مرحبًا، كيف أستطيع مساعدتك في إدارة متجرك؟",
    placeholder: "اكتب طلبك هنا...",
    suggestions: ["اعرض منتجات متجري فقط", "إضافة منتج", "عرض الطلبات"],
    allowedTools: ["product_management", "order_management"],
  },
  admin: {
    welcomeMessage: "مرحبًا بك في لوحة الإدارة.",
    placeholder: "اكتب أمرك هنا...",
    suggestions: ["إدارة المستخدمين", "عرض التقارير"],
    allowedTools: ["user_management", "reports"],
  },
  customer: {
    welcomeMessage: "مرحبًا! كيف يمكنني مساعدتك؟",
    placeholder: "اسألني أي شيء...",
    suggestions: ["تتبع طلبي", "إلغاء طلب"],
    allowedTools: ["order_tracking"],
  },
};
