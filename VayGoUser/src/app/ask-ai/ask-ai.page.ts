import { AfterViewChecked, Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { AuthService } from '../services/auth.service';
import { environment } from 'src/environments/environment';

interface AskAiThread { intent: string; params: Record<string, unknown>; }
interface AskAiTable { columns: string[]; rows: string[][]; }
interface AskAiResponse {
  answer: string;
  intent?: string;
  source?: string;
  table?: AskAiTable | null;
  followUps?: string[];
  thread?: AskAiThread | null;
}
interface AskAiMessage { role: 'q' | 'a'; text: string; table?: AskAiTable | null; followUps?: string[]; }

/** Conversation kept for the app session (survives leaving and re-opening the page). */
const session: { messages: AskAiMessage[]; thread: AskAiThread | null } = { messages: [], thread: null };

/**
 * "Ask VayGoAI" — question/answer page backed by the VayGo AI service
 * (POST {aiBaseUrl}/api/ride/ask). The SAME bearer token the app uses for the Ride API is
 * attached explicitly here (ApiService only targets the Ride API base URL).
 */
@Component({
  selector: 'app-ask-ai',
  templateUrl: './ask-ai.page.html',
  styleUrls: ['./ask-ai.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent],
})
export class AskAiPage implements AfterViewChecked {
  @ViewChild('scrollBody') scrollBody?: ElementRef<HTMLElement>;

  readonly subtitle = 'VayGo Ride · your rides';
  readonly placeholder = 'Ask about your rides, offers…';
  readonly starters = ['Show my past rides', 'Any offers available?', 'How many loyalty points do I have?'];

  messages = session.messages;
  question = '';
  busy = false;
  private lastCount = -1;
  private lastBusy = false;

  constructor(
    private http: HttpClient,
    private auth: AuthService,
    private router: Router,
  ) {}

  back(): void { this.router.navigate(['/home']); }

  submit(): void {
    const q = this.question.trim();
    if (!q || this.busy) { return; }
    this.question = '';
    this.ask(q);
  }

  ask(question: string): void {
    const q = (question || '').trim();
    if (!q || this.busy) { return; }
    session.messages.push({ role: 'q', text: q });
    this.busy = true;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = localStorage.getItem('token');
    if (token) { headers['Authorization'] = `Bearer ${token}`; }
    const body: { question: string; thread?: AskAiThread } = { question: q };
    if (session.thread) { body.thread = session.thread; }

    this.http.post<AskAiResponse>(`${environment.aiBaseUrl}/api/ride/ask`, body, { headers: new HttpHeaders(headers) })
      .subscribe({
        next: res => {
          session.thread = res?.thread ?? null;
          session.messages.push({
            role: 'a',
            text: res?.answer || 'Sorry, I could not find an answer to that.',
            table: res?.table?.columns?.length ? res.table : null,
            followUps: res?.followUps || [],
          });
          this.busy = false;
        },
        error: (err: HttpErrorResponse) => {
          this.busy = false;
          if (err.status === 401) {
            // Session expired — same as the rest of the app: clear it and sign in again.
            session.messages.length = 0;
            session.thread = null;
            this.auth.clearSession();
            this.router.navigate(['/login'], { replaceUrl: true });
            return;
          }
          session.messages.push({
            role: 'a',
            text: err.status === 429
              ? 'Too many questions, wait a minute.'
              : 'Ask VayGoAI is not reachable right now. Please try again.',
          });
        },
      });
  }

  ngAfterViewChecked(): void {
    const count = this.messages.length;
    if (count !== this.lastCount || this.busy !== this.lastBusy) {
      this.lastCount = count;
      this.lastBusy = this.busy;
      const el = this.scrollBody?.nativeElement;
      if (el) { setTimeout(() => el.scrollTop = el.scrollHeight); }
    }
  }
}
