export interface IApiResponse<T> {
  success: boolean;
  data: T;
  message: string;
  pagination?: {
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface IPaginationParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  role?: string;
  status?: string;
  [key: string]: any;
}
