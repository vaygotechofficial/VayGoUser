import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, ToastController } from '@ionic/angular/standalone';
import { ApiService } from '../services/api';
import { getCurrentUserId } from '../services/signalr';
import { environment } from 'src/environments/environment';

interface QuickReply { label: string; value: string; }
interface ChatMessage {
  from: 'bot' | 'user';
  text?: string;
  quickReplies?: QuickReply[];
  complaints?: any[];   // rendered as a complaint list when present
  time: string;
}

type Flow = 'idle' | 'complaint_category' | 'complaint_details' | 'complaint_confirm';

interface Faq { keywords: string[]; answer: string; }

/**
 * VayGo passenger in-app Support assistant — a rule-based chat bot (no external AI,
 * no cost). It answers common questions, raises complaints (into the same RideIssues
 * backend the admin queue reads), and lets the user track complaint status.
 */
@Component({
  selector: 'app-support',
  templateUrl: './support.page.html',
  styleUrls: ['./support.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent]
})
export class SupportPage implements OnInit {
  @ViewChild('scrollBody') scrollBody?: ElementRef<HTMLElement>;

  messages: ChatMessage[] = [];
  input = '';
  botTyping = false;
  submitting = false;

  private flow: Flow = 'idle';
  private draft: { category: 'ReportIssue' | 'LostAndFound'; subject: string; description: string } =
    { category: 'ReportIssue', subject: '', description: '' };
  private activeRideId: number | null = null;

  private readonly welcomeChips: QuickReply[] = [
    { label: 'Raise a complaint', value: 'raise a complaint' },
    { label: 'Track my complaints', value: 'track my complaints' },
    { label: 'Fares & payments', value: 'fares and payments' },
    { label: 'Cancel / refund', value: 'cancel a ride' },
    { label: 'Lost an item', value: 'i lost an item' },
  ];

  // Topic options when raising a complaint via the guided flow.
  private readonly topicChips: QuickReply[] = [
    { label: 'Ride issue', value: 'Ride issue' },
    { label: 'Lost item', value: 'Lost item' },
    { label: 'Payment / refund', value: 'Payment / refund' },
    { label: 'Driver behaviour', value: 'Driver behaviour' },
    { label: 'App problem', value: 'App problem' },
    { label: 'Other', value: 'Other' },
  ];

  // Informational answers. Matched by keyword overlap; highest score wins.
  private readonly faqs: Faq[] = [
    { keywords: ['fare', 'fares', 'price', 'pricing', 'cost', 'charge', 'how much', 'estimate'],
      answer: 'Fares are a base fare plus a per-kilometre rate for your vehicle type, shown as an estimate before you confirm. The final fare can vary slightly with the actual route taken.' },
    { keywords: ['cancel', 'cancellation', 'cancelling'],
      answer: 'You can cancel from your active ride screen. Tap "Cancel ride" and pick a reason. Cancelling after a driver has accepted may occasionally carry a small fee depending on timing.' },
    { keywords: ['refund', 'money back', 'overcharged', 'wrong fare', 'charged extra'],
      answer: 'Refunds are reviewed by our team and credited back to your original payment method, usually within a few business days. If you think a fare was wrong, raise a complaint with the ride details and we\'ll check it.' },
    { keywords: ['payment', 'pay', 'upi', 'card', 'cash', 'wallet'],
      answer: 'You can pay by cash or your saved online payment method. If a payment failed but you were charged, raise a complaint and we\'ll reconcile it.' },
    { keywords: ['lost', 'left', 'forgot', 'phone', 'bag', 'wallet', 'item'],
      answer: 'Sorry about that! I can log a Lost & Found report and our team will try to reach your driver. Tap "Raise a complaint" and choose "Lost item".' },
    { keywords: ['book', 'booking', 'how to book', 'order a ride', 'request'],
      answer: 'Set your pickup and drop on the home screen, choose a vehicle type, and tap to confirm. You\'ll get an OTP to share with your driver at pickup.' },
    { keywords: ['otp', 'code', 'verify', 'login', 'sign in'],
      answer: 'We send a one-time code to your phone to sign in and to verify the start of each ride. If it doesn\'t arrive, wait a moment and request it again.' },
    { keywords: ['driver', 'rude', 'behaviour', 'behavior', 'rash', 'rating'],
      answer: 'Driver conduct matters to us. If something went wrong on a trip, raise a complaint with the details and our team will follow up. For an emergency during a ride, use the SOS button.' },
    { keywords: ['serviceable', 'area', 'available', 'city', 'not serving', 'coverage'],
      answer: 'VayGo currently operates in selected cities. If your pickup or drop is outside a serviceable area, the app will let you know before you book.' },
    { keywords: ['safety', 'emergency', 'sos', 'help', 'unsafe'],
      answer: 'For an emergency during a ride, use the SOS button on your ride screen to alert our safety team with your live location. For non-urgent issues, raise a complaint here.' },
    { keywords: ['schedule', 'scheduled', 'later', 'advance', 'book ahead'],
      answer: 'You can schedule a ride in advance from the Scheduled Rides option in the menu, and we\'ll find you a driver around your chosen time.' },
  ];

  constructor(
    private api: ApiService,
    private router: Router,
    private toastCtrl: ToastController
  ) {}

  ngOnInit() {
    this.activeRideId = this.readActiveRideId();
    this.botSay('Hi! I\'m VayGo Support. I can answer quick questions, raise a complaint for you, or track one you\'ve already raised. How can I help?', this.welcomeChips, 250);
  }

  // ── Input handling ──────────────────────────────────────────

  send() {
    const text = (this.input || '').trim();
    if (!text) return;
    this.input = '';
    this.handleUserText(text);
  }

  tapChip(reply: QuickReply) {
    this.handleUserText(reply.value, reply.label);
  }

  private handleUserText(value: string, displayLabel?: string) {
    this.pushUser(displayLabel || value);

    if (this.flow === 'complaint_category') return this.onCategoryChosen(value);
    if (this.flow === 'complaint_details')  return this.onDetailsGiven(value);
    if (this.flow === 'complaint_confirm')  return this.onConfirm(value);

    this.routeIntent(value);
  }

  // ── Intent routing (idle state) ─────────────────────────────

  private routeIntent(raw: string) {
    const text = raw.toLowerCase();

    if (this.matches(text, ['track', 'status', 'my complaint', 'my complaints', 'my ticket', 'my tickets', 'follow up'])) {
      return this.trackComplaints();
    }

    if (this.matches(text, ['raise a complaint', 'raise complaint', 'file a complaint', 'file complaint', 'make a complaint', 'register a complaint', 'log a complaint', 'new complaint'])) {
      return this.startComplaintGuided();
    }

    // Problem statements → turn the message itself into a complaint draft.
    if (this.looksLikeComplaint(text)) {
      return this.startComplaintFromText(raw);
    }

    const faq = this.bestFaq(text);
    if (faq) {
      return this.botSay(faq.answer, [
        { label: 'Raise a complaint', value: 'raise a complaint' },
        { label: 'Track my complaints', value: 'track my complaints' },
        { label: 'Something else', value: 'menu' },
      ]);
    }

    if (text === 'menu' || this.matches(text, ['common question', 'questions', 'help', 'options', 'menu'])) {
      return this.botSay('Sure — what do you need help with?', this.welcomeChips);
    }

    // No confident match → offer to raise it as a complaint, keeping their text.
    this.draft = { category: 'ReportIssue', subject: 'General query', description: raw.trim() };
    this.botSay('I\'m not totally sure about that one. I can raise it as a complaint so our support team can help you directly — would you like that?', [
      { label: 'Yes, raise it', value: '__raise_kept__' },
      { label: 'See common questions', value: 'menu' },
    ]);
  }

  // ── Complaint flow ──────────────────────────────────────────

  private startComplaintGuided() {
    this.flow = 'complaint_category';
    this.draft = { category: 'ReportIssue', subject: '', description: '' };
    this.botSay('Happy to help. What is your complaint about?', this.topicChips);
  }

  private startComplaintFromText(raw: string) {
    const { category, subject } = this.inferTopic(raw.toLowerCase());
    this.draft = { category, subject, description: raw.trim() };
    this.flow = 'complaint_confirm';
    this.botConfirmSummary();
  }

  private onCategoryChosen(value: string) {
    if (value === '__raise_kept__') {
      // user accepted raising their earlier free-text as a complaint
      this.flow = 'complaint_confirm';
      return this.botConfirmSummary();
    }
    const lc = value.toLowerCase();
    this.draft.category = lc.includes('lost') ? 'LostAndFound' : 'ReportIssue';
    this.draft.subject = value;
    this.flow = 'complaint_details';
    this.botSay(`Got it — "${value}". Please describe what happened in a sentence or two.`);
  }

  private onDetailsGiven(value: string) {
    if (value.trim().length < 3) {
      return this.botSay('Could you add a little more detail so our team can help?');
    }
    this.draft.description = value.trim();
    this.flow = 'complaint_confirm';
    this.botConfirmSummary();
  }

  private onConfirm(value: string) {
    const lc = value.toLowerCase();
    if (this.matches(lc, ['submit', 'yes', 'confirm', 'send', 'ok', 'okay', 'raise'])) {
      return this.submitComplaint();
    }
    if (this.matches(lc, ['cancel', 'no', 'discard', 'never mind', 'nevermind', 'edit'])) {
      this.flow = 'idle';
      return this.botSay('No problem, I\'ve discarded that. Anything else?', this.welcomeChips);
    }
    // treat any other text as an edit to the description
    this.draft.description = value.trim();
    this.botConfirmSummary();
  }

  private botConfirmSummary() {
    const kind = this.draft.category === 'LostAndFound' ? 'Lost & Found' : 'Complaint';
    const ride = this.activeRideId ? `\nRelated ride: #${this.activeRideId}` : '';
    this.botSay(
      `Here's what I'll send:\n\n• Type: ${kind}\n• Topic: ${this.draft.subject || 'General'}\n• Details: ${this.draft.description}${ride}\n\nShall I submit it?`,
      [
        { label: 'Submit', value: 'submit' },
        { label: 'Cancel', value: 'cancel' },
      ]
    );
  }

  private submitComplaint() {
    if (this.submitting) return;
    this.submitting = true;

    const body: any = {
      category: this.draft.category,
      subject: (this.draft.subject || 'Support request').slice(0, 150),
      description: this.draft.description,
      role: 'User',
      channel: 'Bot',
      userId: getCurrentUserId(),
      appVersion: environment.appVersion,
    };
    if (this.activeRideId) body.rideId = this.activeRideId;

    this.botTyping = true;
    this.scrollSoon();
    this.api.post('safety/issue', body).subscribe({
      next: (res: any) => {
        this.submitting = false;
        this.botTyping = false;
        this.flow = 'idle';
        const id = res?.issueId;
        this.messages.push(this.bot(
          id
            ? `✅ Done! Your complaint has been raised${id ? ` (ticket #${id})` : ''}. Our team will review it and you'll be notified of updates. You can check its status here anytime.`
            : '✅ Your complaint has been raised. Our team will review it shortly.',
          [{ label: 'Track my complaints', value: 'track my complaints' }]
        ));
        this.scrollSoon();
      },
      error: () => {
        this.submitting = false;
        this.botTyping = false;
        this.flow = 'idle';
        this.messages.push(this.bot('Sorry, I couldn\'t submit that just now. Please check your connection and try again.', [
          { label: 'Try again', value: 'submit' },
        ]));
        this.scrollSoon();
        this.showToast('Could not submit. Please try again.');
      }
    });
  }

  // ── Tracking ────────────────────────────────────────────────

  private trackComplaints() {
    this.botTyping = true;
    this.scrollSoon();
    this.api.get('safety/issues', { userId: getCurrentUserId() }).subscribe({
      next: (res: any) => {
        this.botTyping = false;
        const list: any[] = Array.isArray(res) ? res : [];
        if (list.length === 0) {
          this.messages.push(this.bot('You haven\'t raised any complaints yet. Want to raise one now?', [
            { label: 'Raise a complaint', value: 'raise a complaint' },
          ]));
        } else {
          const msg = this.bot('Here are your complaints and their current status:');
          msg.complaints = list;
          this.messages.push(msg);
        }
        this.scrollSoon();
      },
      error: () => {
        this.botTyping = false;
        this.messages.push(this.bot('I couldn\'t load your complaints just now. Please try again in a moment.', [
          { label: 'Try again', value: 'track my complaints' },
        ]));
        this.scrollSoon();
      }
    });
  }

  // ── Matching helpers ────────────────────────────────────────

  private matches(text: string, needles: string[]): boolean {
    return needles.some(n => text.includes(n));
  }

  private looksLikeComplaint(text: string): boolean {
    const problem = ['not ', "n't", 'never', 'wrong', 'rude', 'overcharged', 'over charged', 'charged me', 'cheated', 'missing', 'didnt', "didn't", 'did not', 'failed', 'complaint', 'issue', 'problem', 'late', 'rash', 'accident', 'misbehav', 'extra money', 'too much', 'double'];
    const topic = ['ride', 'trip', 'driver', 'fare', 'payment', 'refund', 'money', 'charge', 'lost', 'left', 'app', 'booking', 'cancel'];
    const hasProblem = problem.some(p => text.includes(p));
    const hasTopic = topic.some(t => text.includes(t));
    return hasProblem && hasTopic;
  }

  private inferTopic(text: string): { category: 'ReportIssue' | 'LostAndFound'; subject: string } {
    if (this.matches(text, ['lost', 'left', 'forgot']) && this.matches(text, ['phone', 'bag', 'wallet', 'item', 'thing', 'purse', 'laptop', 'card']))
      return { category: 'LostAndFound', subject: 'Lost item' };
    if (this.matches(text, ['refund', 'overcharged', 'charged', 'money', 'payment', 'fare', 'double']))
      return { category: 'ReportIssue', subject: 'Payment / refund' };
    if (this.matches(text, ['driver', 'rude', 'rash', 'misbehav', 'behaviour', 'behavior']))
      return { category: 'ReportIssue', subject: 'Driver behaviour' };
    if (this.matches(text, ['app', 'crash', 'bug', 'error', 'login', 'otp']))
      return { category: 'ReportIssue', subject: 'App problem' };
    if (this.matches(text, ['ride', 'trip', 'cancel', 'late', 'pickup', 'drop']))
      return { category: 'ReportIssue', subject: 'Ride issue' };
    return { category: 'ReportIssue', subject: 'General issue' };
  }

  private bestFaq(text: string): Faq | null {
    let best: Faq | null = null;
    let bestScore = 0;
    for (const f of this.faqs) {
      const score = f.keywords.reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = f; }
    }
    return bestScore > 0 ? best : null;
  }

  // ── Message plumbing ────────────────────────────────────────

  private now(): string {
    const d = new Date();
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  private bot(text: string, quickReplies?: QuickReply[]): ChatMessage {
    return { from: 'bot', text, quickReplies, time: this.now() };
  }

  private pushUser(text: string) {
    this.messages.push({ from: 'user', text, time: this.now() });
    this.scrollSoon();
  }

  private botSay(text: string, quickReplies?: QuickReply[], delay = 450) {
    this.botTyping = true;
    this.scrollSoon();
    setTimeout(() => {
      this.botTyping = false;
      this.messages.push(this.bot(text, quickReplies));
      this.scrollSoon();
    }, delay);
  }

  private scrollSoon() {
    setTimeout(() => {
      const el = this.scrollBody?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 60);
  }

  statusClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s === 'resolved') return 'resolved';
    if (s === 'inprogress' || s === 'in progress') return 'progress';
    return 'open';
  }

  // ── Misc ────────────────────────────────────────────────────

  private readActiveRideId(): number | null {
    const saved = localStorage.getItem('userActiveBooking');
    if (!saved) return null;
    try {
      const d = JSON.parse(saved);
      const state = d?.state;
      if (state === 'accepted' || state === 'started') return d?.activeRide?.rideId ?? null;
    } catch { return null; }
    return null;
  }

  private async showToast(message: string) {
    const t = await this.toastCtrl.create({ message, duration: 2500, position: 'bottom' });
    await t.present();
  }

  back() {
    this.router.navigate(['/home']);
  }
}
