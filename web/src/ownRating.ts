/** /api/me returns reputation from users, not performer_profiles. */
export type OwnRating = {rating?: unknown; rating_count?: unknown};
export function ownRatingLabel(account: OwnRating | null | undefined): string {
  if (!account) return 'Рейтинг уточняется';
  const count = account.rating_count;
  const rating = account.rating;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return 'Рейтинг уточняется';
  if (count === 0) return 'Пока нет оценок';
  if (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 1 || rating > 5) return 'Рейтинг уточняется';
  const last = count % 10, lastTwo = count % 100;
  const word = last === 1 && lastTwo !== 11 ? 'оценка' : last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14) ? 'оценки' : 'оценок';
  return '★ ' + rating.toFixed(1).replace('.', ',') + ' · ' + count + ' ' + word;
}
