import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '@environments/environment';
import { IApiResponse } from '../interfaces/api-response.interface';

export interface IExpense {
  _id: string;
  description: string;
  amount: number;
  month: string; // YYYY-MM
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private apiUrl = `${environment.apiUrl}/expenses`;

  constructor(private http: HttpClient) {}

  list(params?: { month?: string }): Observable<IExpense[]> {
    return this.http.get<IApiResponse<IExpense[]>>(this.apiUrl, { params: params as any }).pipe(
      map(res => res.data || [])
    );
  }

  create(body: { description: string; amount: number; month: string }): Observable<IExpense> {
    return this.http.post<IApiResponse<IExpense>>(this.apiUrl, body).pipe(
      map(res => res.data)
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<IApiResponse<void>>(`${this.apiUrl}/${id}`).pipe(
      map(() => undefined)
    );
  }
}
