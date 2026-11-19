/**
 * Bank Tochka invoice document API. This does not move money and must not mark
 * an order paid: invoice payment status may be edited in Tochka's back office.
 * Enable only after contractual approval of agent / principal invoice wording.
 * https://developers.tochka.com/docs/tochka-api/api/rabota-s-vystavleniem-schetov
 */
export type TochkaVat = 'without_nds' | 'nds_0' | 'nds_5' | 'nds_7' | 'nds_10' | 'nds_22';
export interface TochkaBuyer {
  type: 'company' | 'ip';
  taxCode: string;
  secondSideName: string;
  kpp?: string;
  legalAddress?: string;
  accountId?: string;
  bankName?: string;
  bankCorrAccount?: string;
}
export interface TochkaInvoiceLine {
  title: string;
  kopecks: number;
  vat: TochkaVat;
}
export interface TochkaInvoiceRequest {
  number: string;
  basedOn: string;
  buyer: TochkaBuyer;
  lines: TochkaInvoiceLine[];
  expectedTotalKopecks: number;
}
export type TochkaInvoiceStatus = 'payment_waiting' | 'payment_paid' | 'payment_expired';

const API = 'https://enter.tochka.com/uapi';
const rubles = (kopecks: number) => (kopecks / 100).toFixed(2);
const pathId = (value: string) => encodeURIComponent(value);
const validMoney = (value: number) => Number.isSafeInteger(value) && value >= 0;

export class TochkaInvoiceClient {
  constructor(
    private readonly token: string,
    private readonly customerCode: string,
    private readonly accountId: string,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (!token || !/^\d{9}$/.test(customerCode) || !/^\d{20}\/\d{9}$/.test(accountId))
      throw new Error('Tochka invoice API credentials/account identifiers are incomplete');
  }

  private async request(path: string, method: 'GET' | 'POST', body?: unknown): Promise<Response> {
    const response = await this.transport(API + path, {
      method,
      headers: {
        authorization: 'Bearer ' + this.token,
        accept: 'application/json, application/pdf',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(12_000),
    });
    // Do not log upstream error text: bank may include sensitive data.
    if (!response.ok) throw new Error('Tochka invoice API HTTP ' + response.status);
    return response;
  }

  async createInvoice(request: TochkaInvoiceRequest): Promise<string> {
    if (request.lines.length < 1 ||
      !request.lines.every(l => validMoney(l.kopecks) && l.kopecks > 0) ||
      !validMoney(request.expectedTotalKopecks) ||
      request.lines.reduce((sum, item) => sum + item.kopecks, 0) !== request.expectedTotalKopecks)
      throw new Error('Invoice lines do not balance with the order total');
    if (!request.buyer.taxCode || !request.buyer.secondSideName)
      throw new Error('Buyer legal details are required');
    const positions = request.lines.map(item => ({
      positionName: item.title,
      unitCode: 'услуга.',
      ndsKind: item.vat,
      price: rubles(item.kopecks),
      quantity: 1,
      totalAmount: rubles(item.kopecks),
    }));
    const payload = {
      Data: {
        accountId: this.accountId,
        customerCode: this.customerCode,
        SecondSide: request.buyer,
        Content: {
          Invoice: {
            Positions: positions,
            totalAmount: rubles(request.expectedTotalKopecks),
            number: request.number,
            basedOn: request.basedOn,
          },
        },
      },
    };
    const response = await this.request('/invoice/v1.0/bills', 'POST', payload);
    const json = await response.json() as any;
    const id = json?.Data?.documentId;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id))
      throw new Error('Tochka invoice creation reply had no documentId');
    return id;
  }

  async emailInvoice(documentId: string, email: string): Promise<void> {
    const response = await this.request(
      '/invoice/v1.0/bills/' + pathId(this.customerCode) + '/' + pathId(documentId) + '/email',
      'POST', { Data: { email } });
    const json = await response.json() as any;
    if (json?.Data?.result !== true) throw new Error('Tochka did not confirm invoice email delivery request');
  }

  async getPaymentStatus(documentId: string): Promise<TochkaInvoiceStatus> {
    const response = await this.request(
      '/invoice/v1.0/bills/' + pathId(this.customerCode) + '/' + pathId(documentId) + '/payment-status',
      'GET');
    const json = await response.json() as any;
    const status = json?.Data?.paymentStatus ?? json?.Data?.status;
    if (!['payment_waiting', 'payment_paid', 'payment_expired'].includes(status))
      throw new Error('Unexpected Tochka invoice status payload');
    return status;
  }

  async getInvoicePdf(documentId: string): Promise<Buffer> {
    const response = await this.request(
      '/invoice/v1.0/bills/' + pathId(this.customerCode) + '/' + pathId(documentId) + '/file',
      'GET');
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/pdf'))
      throw new Error('Unexpected invoice document MIME type');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 5 || bytes.length > 5_000_000 ||
      bytes.subarray(0, 5).toString('ascii') !== '%PDF-')
      throw new Error('Invalid invoice PDF returned by bank');
    return bytes;
  }
}
