import {unstable_cache} from 'next/cache';
import {readPublicHorizon} from './horizon-service';
import {assessOfficialIndexes} from '../horizon/official-indexes';
export const publicIndexComparison=unstable_cache(async()=>assessOfficialIndexes(await readPublicHorizon()),['official-publication-index-comparison-v1'],{revalidate:300});
