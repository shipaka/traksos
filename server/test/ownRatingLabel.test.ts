import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ownRatingLabel} from '../../web/src/ownRating.ts';

test('rating label uses only actual finite account aggregate and count',()=>{
  assert.equal(ownRatingLabel({rating:4.82,rating_count:12}),'★ 4,8 · 12 оценок');
  assert.equal(ownRatingLabel({rating:5,rating_count:1}),'★ 5,0 · 1 оценка');
  assert.equal(ownRatingLabel({rating:3,rating_count:22}),'★ 3,0 · 22 оценки');
  assert.equal(ownRatingLabel({rating:null,rating_count:0}),'Пока нет оценок');
  assert.equal(ownRatingLabel({rating:5,rating_count:0}),'Пока нет оценок');
  for(const input of [null,{}, {rating:NaN,rating_count:1},{rating:6,rating_count:1},
    {rating:0,rating_count:1},{rating:null,rating_count:3},{rating:4.8,rating_count:-1},
    {rating:4.8,rating_count:1.5},{rating:'4.8',rating_count:1}])
    assert.equal(ownRatingLabel(input),'Рейтинг уточняется');
});
