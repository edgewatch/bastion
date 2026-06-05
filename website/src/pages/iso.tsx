import React from 'react';
import {Redirect} from '@docusaurus/router';

/** Legacy `/iso` URL → downloads landing at `/`. */
export default function IsoRedirect(): React.ReactElement {
  return <Redirect to="/" />;
}
