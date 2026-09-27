'use client';

import { useParams } from 'next/navigation';
import { MovieEditor } from '../../../../components/admin/movie-editor';

export default function AdminMoviePage() {
  const params = useParams();
  return <MovieEditor id={params.id} />;
}
