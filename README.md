[![Magnet.me Logo](https://cdn.magnet.me/images/logo-2015-full.svg)](https://magnet.me?ref=github-mm-experiments "Discover the best companies, jobs and internships at Magnet.me")

# mm-experiments

Set of directives to integrate A/B testing in an Angular application.

Usage with Google Experiments:

```javascript
app
	.run((experiments, googleExperiments) => {
		//Configure all the things
		experiments.setVariationFactory('my-experiment', () => googleExperiments.getVariation('googleExperimentId'));
	})
```
```html
	<div mm-experiment="my-experiment">
		<h1 mm-variation="0">Stuff</h1>
		<h1 mm-variation="1">Other stuff</h1>
		<p>
			Above is showing variation {{$variation}}
		</p>
	</div>
```

# Caveats

## Some experiment providers (e.g. Google Analytics) require you to send an additional request after loading the experiment
This module only loads the experiment in the browser, but does not automatically send anything to your experiments provider. For example, Google Analytics requires that at least one hit is send to Google Analytics after loading the experiments. This module does not do that for you since this we do not know how you interact with Google Analytics (this is application specific) and therefore we cannot determine an appropriate action to take to send the hit to GA.
