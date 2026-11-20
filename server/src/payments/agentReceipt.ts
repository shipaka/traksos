// Historical receipt/settlement formatting retained independently of a retired provider.
// This is NOT evidence that a fiscal provider or live acquiring is configured.
const toValue = (kopecks: number) => ({ value: (kopecks / 100).toFixed(2), currency: 'RUB' });

/**
 * Чек 54-ФЗ при агентской схеме: позиция исполнителя — с признаком агента и данными поставщика,
 * сервисный сбор — собственная услуга TrakSOS. Для самозанятых порядок уточнить у бухгалтера.
 */
export function agentReceipt(p: {
  customerPhone: string;
  items: { description: string; amount: number; supplier?: { name: string; inn: string; phone?: string } }[];
}) {
  return {
    customer: { phone: p.customerPhone.replace('+', '') },
    items: p.items.map((i) => ({
      description: i.description.slice(0, 128),
      quantity: '1.00',
      amount: toValue(i.amount),
      vat_code: 1, // без НДС — уточнить у бухгалтера
      payment_mode: 'full_payment',
      payment_subject: 'service',
      ...(i.supplier ? { agent_type: 'agent', supplier: { name: i.supplier.name, inn: i.supplier.inn, phone: i.supplier.phone } } : {}),
    })),
  };
}
