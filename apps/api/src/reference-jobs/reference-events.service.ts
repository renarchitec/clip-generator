import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { ReferenceJobResponse } from '@clipper/shared';

@Injectable()
export class ReferenceEventsService {
  private readonly streams = new Map<string, Subject<ReferenceJobResponse>>();
  publish(snapshot: ReferenceJobResponse): void { this.streamFor(snapshot.id).next(snapshot); }
  watch(id: string): Observable<ReferenceJobResponse> { return this.streamFor(id).asObservable(); }
  close(id: string): void { const stream = this.streams.get(id); if (stream) { stream.complete(); this.streams.delete(id); } }
  private streamFor(id: string): Subject<ReferenceJobResponse> {
    let stream = this.streams.get(id);
    if (!stream) { stream = new Subject<ReferenceJobResponse>(); this.streams.set(id, stream); }
    return stream;
  }
}
